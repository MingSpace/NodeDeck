import { z } from "zod";
import { idSchema, refreshSchema, tagsSchema } from "./common.js";

export const parserHintSchema = z.enum([
  "auto",
  "clash",
  "surge",
  "v2ray_base64",
  "ss_links",
  "trojan_links",
  "hysteria2_links",
  // mixed: 逐行 try-each-parser(URI / Surge 行),允许同一文本内混贴。
  // 参考 Sub-Store backend line dispatcher 风格,适合"local node list"/单节点拼盘。
  "mixed",
]);

// Clash Mihomo 的 proxy-provider 配置(可选,Profile 启用 use_proxy_providers 时生效)。
// 启用后每个 provider 的节点不再内联进 proxies,而是 mihomo 客户端自己去拉取
// /sub/provider/:id/clash.yaml,带来更小的主订阅 + 各机场独立健康检查。
export const clashProxyProviderSchema = z.object({
  enabled: z.boolean().default(false),
  // Mihomo proxy-provider 必填,默认值见 mihomo 文档。这里用 url-test 风格的最常见组合。
  health_check_url: z.string().url().default("http://www.gstatic.com/generate_204"),
  health_check_interval: z.number().int().min(60).max(86400).default(300),
});

const localDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式为 YYYY-MM-DD")
  .refine((s) => {
    // new Date(2026, 1, 30) 会静默进位成 3 月 2 日,回读比对才能拦住非法日期
    const [y, m, d] = s.split("-").map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }, "无效日期");

// 流量 / 到期配额。在线源上游带 Subscription-UserInfo 时以上游为准,这里的手填值只作补充;
// 离线源(inline / 拿不到 userinfo 的源)全靠这里。判定逻辑见 providers/quota.ts。
// 日期一律按进程本地时区的零点解释(容器需设 TZ,见 docs/deployment.md)。
export const providerQuotaSchema = z.object({
  // 用完或过期时,生成订阅自动排除该源;关掉则只展示状态、照常输出
  auto_exclude: z.boolean().default(true),
  // 每月流量重置日;当月没有这一天(如 31 号)按月末算
  reset_day: z.number().int().min(1).max(31).optional(),
  // 手填到期日;上游 userinfo 带 expire 时以上游为准
  expire: localDateSchema.optional(),
  // 手动标记「流量用完」,排除到这天零点自动恢复
  exhausted_until: localDateSchema.optional(),
});

// 拉取线路:出口 id(见 schemas/egress.ts)与保留字 `direct` 按顺序排,前一条失败换下一条。
// 直连是固定兜底:没写 `direct` 时排在最后,空 = 只用服务器直连(见 resolveFetchRoutes)。
export const fetchViaSchema = z
  .array(idSchema)
  .default([])
  .refine((ids) => new Set(ids).size === ids.length, "拉取线路里有重复项");

/**
 * 拉订阅时依次尝试的 User-Agent(节点源 user_agents 留空时用)。机场面板按 UA 子串决定吐什么格式,
 * 以 Xboard 为例(app/Protocols/*.php 的 $flags):含 `meta` / `verge` / `clashmetaforandroid`
 * → Clash Meta YAML(vless / hy2 / tuic / anytls 全量,带顶层 hosts:);只含 `clash` → 老 Clash 格式,
 * 不含 vless / hy2 / tuic / anytls;空 UA 或不认识的 UA → base64 URI 列表。版本号会被拿去和
 * 面板的协议最低版本比,所以写当前正式版。
 * - `clash.meta/…`:mihomo 内核自己拉 proxy-provider 的默认 UA(config.go GlobalUA),认 mihomo 的网关都放行
 * - `clash-verge/…`:Clash Verge Rev;有些网关只放行已知 GUI 客户端
 * - 空 UA / `v2rayN/…`:兜底拿通用 URI 列表
 * 与 frontend/src/pages/providers/user-agents.tsx USER_AGENT_PRESETS 保持同步。
 */
export const DEFAULT_USER_AGENTS = ["clash.meta/v1.19.33", "clash-verge/v2.5.8", "", "v2rayN/7.25.6"];

// 空数组 = 用 DEFAULT_USER_AGENTS;空字符串是合法候选(显式不带 UA)。
export const userAgentsSchema = z
  .array(z.string().trim().max(256, "User-Agent 太长"))
  .max(12, "User-Agent 最多 12 个")
  .default([])
  .refine((list) => new Set(list).size === list.length, "User-Agent 列表里有重复项");

export function resolveUserAgents(list: readonly string[] | undefined): string[] {
  return list?.length ? [...list] : [...DEFAULT_USER_AGENTS];
}

// 旧版单值 `user_agent`:语义是「先试它,拿不到再走内置回退列表」,读入时折成等价的 user_agents。
// 下次保存就只剩 user_agents,老 yaml 不用手改。
function migrateLegacyUserAgent(raw: unknown): unknown {
  if (!raw || typeof raw !== "object" || !("user_agent" in raw)) return raw;
  const { user_agent: legacy, ...rest } = raw as Record<string, unknown>;
  if (rest.user_agents !== undefined || typeof legacy !== "string" || !legacy.trim()) return rest;
  return { ...rest, user_agents: [...new Set([legacy.trim(), ...DEFAULT_USER_AGENTS])] };
}

const providerObjectSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    type: z.enum(["http", "file", "inline"]),
    // 表单里清空 URL 会提交空字符串,按「没填」处理,否则 .url() 直接报格式错误
    url: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().url().optional()),
    path: z.string().optional(),
    content: z.string().optional(),
    // 按顺序试,拿到能解析出节点的内容为止;留空用 DEFAULT_USER_AGENTS(见 providers/fetcher.ts)
    user_agents: userAgentsSchema,
    // 仅 http 类型生效;见 providers/fetcher.ts
    fetch_via: fetchViaSchema,
    refresh: refreshSchema.default({ interval: "12h" }),
    parser_hint: parserHintSchema.default("auto"),
    enabled: z.boolean().default(true),
    tags: tagsSchema,
    // 节点名来源前缀 `【xx】` 里的标识;留空则从 name 自动取 1~2 个字(见 generators/node-naming.ts)。
    // 禁 `= , "`:前缀会进 Surge 节点名,这几个字符会被 escapeSurgeNames 改成 `_`。
    name_prefix: z
      .string()
      .trim()
      .refine((s) => [...s].length <= 4, "前缀最多 4 个字符(建议 1~2 个字)")
      .refine((s) => !/[=,"\r\n【】]/.test(s), "前缀不能包含 = , \" 【 】")
      .optional(),
    notes: z.string().optional(),
    clash_proxy_provider: clashProxyProviderSchema.default({
      enabled: false,
      health_check_url: "http://www.gstatic.com/generate_204",
      health_check_interval: 300,
    }),
    // 针对该节点源的 DNS 解析覆盖([CS] hosts);emit_hosts 控制是否在订阅输出时自动带出。
    // 典型用途:机场为规避封锁,给代理节点域名指定多个 server: DoH(同 key 多行)。
    hosts: z.record(z.union([z.string(), z.array(z.string())])).optional(),
    emit_hosts: z.boolean().default(true),
    quota: providerQuotaSchema.optional(),
  })
  .superRefine((p, ctx) => {
    if (p.type === "http" && !p.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "http provider requires `url`", path: ["url"] });
    }
    if (p.type === "file" && !p.path) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "file provider requires `path`", path: ["path"] });
    }
    if (p.type === "inline" && !p.content) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "inline provider requires `content`", path: ["content"] });
    }
  })
  // 编辑弹窗在「URL 订阅 / 静态节点」之间切换时会保留另一边的 URL 草稿,落盘时丢掉:
  // 静态节点 / 本地文件用不到 URL,留着只会在列表上显示一个不相干的地址
  .transform((p) => (p.type === "http" ? p : { ...p, url: undefined }));

export const providerSchema = z.preprocess(migrateLegacyUserAgent, providerObjectSchema);

export type Provider = z.infer<typeof providerSchema>;
export type ProviderQuota = z.infer<typeof providerQuotaSchema>;
