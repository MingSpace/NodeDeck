import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import { env } from "../env.js";
import { loadConfig } from "../storage/config-store.js";
import { getSessionSecret } from "../auth/secret.js";

/** 与 routes/sub.ts 的 /module/:file 路由保持同步 */
export function modulePublicPath(id: string): string {
  return `/module/${id}.sgmodule`;
}

export async function publicBaseUrl(c: Context): Promise<string> {
  const cfg = await loadConfig();
  return cfg.public_base_url ?? env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
}

/**
 * 非公开模块的访问 token = HMAC(服务端密钥 data/secret.key, 模块 id),截 22 位 base64url(132 bit)。
 * - 不落盘:老模块不用迁移,也不会因为编辑模块而变;每个模块各不相同,泄露一个不影响其它模块
 * - 想让所有模块链接失效:删 data/secret.key 重启(会同时踢掉所有登录会话)
 */
export function moduleAccessToken(id: string, secret: string = getSessionSecret()): string {
  return createHmac("sha256", secret).update(`surge-module:${id}`).digest("base64url").slice(0, 22);
}

export function verifyModuleToken(id: string, token: string | undefined): boolean {
  if (!token) return false;
  const expected = Buffer.from(moduleAccessToken(id));
  const given = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * 设备上安装用的链接:模块地址(非公开模块带 ?t=)+ Surge 的一键安装 URL scheme
 * (`surge:///install-module?url=<percent-encoded>`,manual.nssurge.com/tools/url-scheme.html)。
 */
export function moduleLinks(
  baseUrl: string,
  id: string,
  isPublic: boolean,
): { url: string; install_url: string } {
  const path = `${baseUrl.replace(/\/+$/, "")}${modulePublicPath(id)}`;
  const url = isPublic ? path : `${path}?t=${moduleAccessToken(id)}`;
  return { url, install_url: `surge:///install-module?url=${encodeURIComponent(url)}` };
}
