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

export const providerSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    type: z.enum(["http", "file", "inline"]),
    url: z.string().url().optional(),
    path: z.string().optional(),
    content: z.string().optional(),
    user_agent: z.string().default("Surge/2400"),
    refresh: refreshSchema.default({ interval: "12h" }),
    parser_hint: parserHintSchema.default("auto"),
    enabled: z.boolean().default(true),
    tags: tagsSchema,
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
