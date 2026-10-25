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

export const FETCH_PROXY_PROTOCOLS = ["http:", "https:", "socks5:", "socks:"] as const;

// 拉取订阅时走的代理。典型用途:机场按来源 IP 拦截(服务器在境外被 403),
// 借另一台机器的网络出口去拉。空串视为未配置(直连),方便 Web UI 清空字段。
export const fetchProxySchema = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z
    .string()
    .trim()
    .url("代理地址格式不对,示例 http://172.18.0.1:18888 或 socks5://127.0.0.1:1080")
    .refine(
      // .url() 失败时 zod 仍会跑 refine,new URL 要兜住
      (s) => URL.canParse(s) && (FETCH_PROXY_PROTOCOLS as readonly string[]).includes(new URL(s).protocol),
      "代理只支持 http:// / https:// / socks5://",
    )
    .optional(),
);

export const providerSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    type: z.enum(["http", "file", "inline"]),
    url: z.string().url().optional(),
    path: z.string().optional(),
    content: z.string().optional(),
    // 默认留空:很多机场按 UA 网关,Surge 系会被吐空 body。空 UA 先试,拿到空响应时
    // fetcher 会自动回退到 Clash 系等候选 UA(见 providers/fetcher.ts FALLBACK_USER_AGENTS)。
    user_agent: z.string().default(""),
    // 仅 http 类型生效;见 providers/fetch-proxy.ts
    fetch_proxy: fetchProxySchema,
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
  });

export type Provider = z.infer<typeof providerSchema>;
export type ProviderQuota = z.infer<typeof providerQuotaSchema>;
