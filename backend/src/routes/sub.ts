import type { Hono } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { profileRepo, surgeModuleRepo } from "../storage/repos.js";
import { loadRemoteModule } from "../surge-modules/remote.js";
import { renderLocalSgmodule } from "../surge-modules/sgmodule.js";
import { verifyModuleToken } from "../surge-modules/links.js";
import { resolveProfile } from "../generators/profile-resolver.js";
import { generateSurgeConfig } from "../generators/surge.js";
import { aggregateUserInfo } from "../userinfo/aggregate.js";
import { env } from "../env.js";
import { loadConfig } from "../storage/config-store.js";
import { logger } from "../logger.js";
import { getClientIp } from "../auth/middleware.js";
import { notifySubWarnings } from "../notifications/service.js";
import { recordPull, recordRejected } from "../stats/pull-stats.js";

export function mountSubRoute(app: Hono): void {
  app.get("/sub", async (c) => handleSub(c));
  app.get("/sub/surge/:profile", async (c) => {
    const profile = c.req.param("profile");
    const t = c.req.query("t") ?? "";
    return handleSubInner(c, { profile, target: "surge", t });
  });
  // 单个 Surge 模块,设备上「从 URL 安装模块」用。不挂在 /sub 下,地址短一些。
  // 默认要带 ?t=<模块 token>;模块开了 public 才允许不带(远程模块的上游 URL 不会出现在响应里)。
  app.get("/module/:file", async (c) => handleModuleFile(c));
}

async function handleModuleFile(c: import("hono").Context) {
  const match = /^([A-Za-z0-9_-]+)\.sgmodule$/.exec(c.req.param("file") ?? "");
  if (!match) return c.text("not found", 404);
  const entry = await surgeModuleRepo.get(match[1]);
  // token 不对与模块不存在返回同样的 404,不暴露有哪些模块 id
  if (!entry) return c.text("module not found", 404);
  const mod = entry.data;
  if (!mod.public && !verifyModuleToken(mod.id, c.req.query("t"))) {
    logger.warn({ moduleId: mod.id, ip: getClientIp(c), hasToken: !!c.req.query("t") }, "Module request: token mismatch");
    return c.text("module not found", 404);
  }
  let text: string;
  if (mod.source === "remote") {
    const cache = await loadRemoteModule(mod);
    if (cache.text === undefined) {
      logger.warn({ moduleId: mod.id, error: cache.error }, "Module request: remote content unavailable");
      return c.text("module content unavailable", 502);
    }
    text = cache.text;
  } else {
    text = renderLocalSgmodule(mod);
  }
  logger.info({ moduleId: mod.id, source: mod.source, ip: getClientIp(c), bytes: text.length }, "Module served");
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Cache-Control", "no-cache");
  return c.body(text);
}

async function handleSub(c: import("hono").Context) {
  const profileId = c.req.query("profile") ?? "";
  // target 可省略,缺省即 surge;仍接受显式的 target=surge,保证旧链接 / managed-config URL 不变
  const target = c.req.query("target") ?? "surge";
  const t = c.req.query("t") ?? "";
  return handleSubInner(c, { profile: profileId, target, t });
}

async function handleSubInner(
  c: import("hono").Context,
  args: { profile: string; target: string; t: string },
) {
  const ip = getClientIp(c);
  if (!args.profile || !args.t) {
    logger.info(
      { profileId: args.profile || null, ip },
      "Sub request rejected: missing query parameters",
    );
    return c.text("missing query parameters: profile, t", 400);
  }
  if (args.target !== "surge") {
    logger.info(
      { profileId: args.profile, target: args.target, ip },
      "Sub request rejected: invalid target",
    );
    return c.text("仅支持 target=surge（Clash 输出已移除）", 400);
  }
  const entry = await profileRepo.get(args.profile);
  if (!entry) {
    logger.info({ profileId: args.profile, target: args.target, ip }, "Sub request: profile not found");
    return c.text("profile not found", 404);
  }
  const profile = entry.data;
  if (profile.token !== args.t) {
    logger.warn({ profileId: profile.id, target: args.target, ip }, "Sub request: token mismatch");
    recordRejected();
    return c.text("invalid token", 401);
  }

  const resolved = await resolveProfile(profile);
  // 只统计 token 校验通过的拉取;生成抛错走 onError 返回 500,不计数
  const userAgent = c.req.header("user-agent");
  const statsIp = ip !== "unknown" ? ip : socketAddress(c);

  // Build managed-config URL
  const cfg = await loadConfig();
  const baseUrl = cfg.public_base_url ?? env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  let managedConfigUrl: string | undefined;
  if (profile.managed_config_url === "auto") {
    managedConfigUrl = `${baseUrl}/sub?profile=${profile.id}&target=surge&t=${profile.token}`;
  } else if (profile.managed_config_url !== "none") {
    managedConfigUrl = profile.managed_config_url;
  }

  // userinfo: 完全可选;关闭时不读 cache 也不写任何相关响应头
  if (profile.userinfo.enabled) {
    const userinfoResult = await aggregateUserInfo(profile);
    if (userinfoResult.aggregated) {
      const headerVal = formatUserInfo(userinfoResult.aggregated);
      if (headerVal) c.header("Subscription-UserInfo", headerVal);
    }
    if (profile.userinfo.expose_per_provider_headers) {
      for (const item of userinfoResult.perProvider) {
        if (item.raw_header) {
          c.header(`X-NodeDeck-Userinfo-${item.provider_id}`, item.raw_header);
        }
      }
    }
  }

  // Profile-Update-Interval 单位 = 小时,从 profile.managed_config_interval(秒)派生
  const intervalHours = String(Math.max(1, Math.round(profile.managed_config_interval / 3600)));

  resolved.warnings.push(...resolved.surgeWarnings);
  const text = generateSurgeConfig({
    profile,
    nodes: resolved.nodes,
    providers: resolved.providers,
    groups: resolved.groups,
    allKnownGroupNames: resolved.allKnownGroupNames,
    rules: resolved.rules,
    finalRule: resolved.finalRule,
    geoipFallback: resolved.geoipFallback,
    general: resolved.general,
    hosts: resolved.hosts,
    surgeModules: resolved.surgeModules,
    managed_config_url: managedConfigUrl,
    warnings: resolved.warnings,
  });
  logSubGenerated(profile.id, resolved.nodes.length, resolved.warnings, text.length, ip);
  recordPull({ profileId: profile.id, ip: statsIp, userAgent });
  c.header("Content-Type", "text/plain; charset=utf-8");
  c.header("Content-Disposition", buildContentDisposition(profile.name, "conf", profile.id));
  c.header("Profile-Update-Interval", intervalHours);
  return c.body(text);
}

/**
 * 没经过反代(没有 X-Forwarded-For / X-Real-IP)时取 TCP 对端地址,只给拉取统计区分设备用;
 * getClientIp 本身不改,它还管着限流和日志。测试里的 app.request 没有 socket,取不到就算 unknown。
 */
function socketAddress(c: import("hono").Context): string {
  try {
    return getConnInfo(c).remote.address?.replace(/^::ffff:/, "") ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * 把单次 generator 调用的产物聚合成日志:
 * - 1 条 info 表示生成成功(总览)
 * - 若 warnings 非空再补 1 条 warn,内容为整个数组(避免 N 条 warn 刷屏)
 */
function logSubGenerated(
  profileId: string,
  nodeCount: number,
  warnings: string[],
  size: number,
  ip: string,
): void {
  const target = "surge";
  logger.info(
    {
      profileId,
      target,
      nodeCount,
      warningCount: warnings.length,
      size,
      ip,
    },
    "Sub generated",
  );
  if (warnings.length > 0) {
    logger.warn(
      { profileId, target, count: warnings.length, warnings },
      "Generator produced warnings",
    );
    // Bark 通知(可选配,service 内部按内容 hash 冷却,避免客户端轮询刷屏)
    void notifySubWarnings(profileId, target, warnings);
  }
}

function formatUserInfo(info: { upload: number; download: number; total: number; expire: number }): string {
  const parts: string[] = [];
  parts.push(`upload=${info.upload}`);
  parts.push(`download=${info.download}`);
  if (info.total) parts.push(`total=${info.total}`);
  if (info.expire) parts.push(`expire=${info.expire}`);
  return parts.join("; ");
}

/**
 * 把 profile 的展示名(displayName,可能含中文/空格/特殊字符)做成合法下载文件名,
 * 并按 RFC 6266 + RFC 5987 拼出 Content-Disposition 的值,同时给出 ASCII fallback,
 * 这样 Surge / 浏览器都能拿到友好的文件名(中文也不丢)。
 *
 * - `filename="..."` (ASCII fallback): 只保留 ASCII 可见字符,空了就回退到 fallbackBaseName(通常是 id)
 * - `filename*=UTF-8''...` (RFC 5987): 对净化后的完整 name 做 percent-encode,保留中文 / emoji
 */
function buildContentDisposition(displayName: string, ext: string, fallbackBaseName: string): string {
  const cleaned = sanitizeFilenameBase(displayName);
  const fallbackClean = sanitizeFilenameBase(fallbackBaseName) || "download";
  const utf8Base = cleaned || fallbackClean;

  const asciiFromName = stripToAscii(utf8Base);
  const asciiBase = asciiFromName || stripToAscii(fallbackClean) || "download";

  const utf8Filename = `${utf8Base}.${ext}`;
  const asciiFilename = `${asciiBase}.${ext}`;

  return `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeRFC5987(utf8Filename)}`;
}

function sanitizeFilenameBase(name: string): string {
  return name
    // 控制字符(0x00-0x1F)和 DEL(0x7F)在下载文件名里非法
    // eslint-disable-next-line no-control-regex -- 这里就是要匹配控制字符本身
    .replace(/[\u0000-\u001F\u007F]/g, "")
    // Windows + 大多数客户端禁止的路径分隔/通配符,统一替换成下划线
    .replace(/[\\/:*?"<>|]/g, "_")
    // 多个连续空白合成单个空格,避免出现 "a   b.yaml" 这种奇怪文件名
    .replace(/\s+/g, " ")
    .trim()
    // Windows 不允许文件名以 . 结尾(也容易在客户端被误处理)
    .replace(/\.+$/, "")
    .trim();
}

function stripToAscii(name: string): string {
  return name
    // 只保留 ASCII 可见字符,丢中文/emoji
    .replace(/[^\x20-\x7E]/g, "")
    // ASCII fallback 里再次去掉双引号 / 反斜杠,确保 filename="..." 不被破坏
    .replace(/["\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

function encodeRFC5987(value: string): string {
  // encodeURIComponent 已经处理了大多数 unsafe 字符,但 RFC 5987 还要求 ' ( ) * 也编码
  return encodeURIComponent(value).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}
