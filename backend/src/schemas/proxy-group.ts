import { z } from "zod";
import { idSchema } from "./common.js";

export const proxyGroupTypeSchema = z.enum([
  "select", // [CS]
  "url-test", // [CS]
  "fallback", // [CS]
  "load-balance", // [CS]
  "smart", // [S] iOS 5.14+ Surge Smart
  "ssid", // [S]
  "external", // [S] external proxy program
]);

export const selectorSchema = z.object({
  include_regex: z.string().optional(),
  exclude_regex: z.string().optional(),
  include_other_group: z.array(z.string()).default([]),
  from_providers: z.array(z.string()).default([]),
  exclude_type: z.array(z.string()).default([]),
  // 地区白名单:空 = 不限制;非空 = 只保留 node.region ∈ 列表 的节点。
  // 用 string[] 而不是 regionCodeSchema[],给将来加新国家留余地,旧 yaml 不会失效。
  include_region: z.array(z.string()).default([]),
});

export const proxyGroupSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  type: proxyGroupTypeSchema.default("select"),

  // explicit list (mixed: node names / DIRECT / REJECT / other group names)
  proxies: z.array(z.string()).default([]),

  // dynamic selector
  selector: selectorSchema.optional(),

  // [CS] test parameters
  url: z.string().url().optional(),
  interval: z.number().int().min(1).max(86400).optional(),
  tolerance: z.number().int().min(0).max(10000).optional(),
  timeout: z.number().int().min(1).max(60).optional(),

  // [S] surge-only
  evaluate_before_use: z.boolean().optional(),
  hidden: z.boolean().optional(),
  persistent: z.boolean().optional(),
  policy_path: z.string().optional(),
  hybrid: z.boolean().optional(),
  policy_regex_filter: z.string().optional(),
  no_alert: z.boolean().optional(),
  include_all_proxies: z.boolean().optional(),
  include_other_group: z.string().optional(), // [S] alternate way

  // [C] clash-only
  lazy: z.boolean().optional(),
  disable_udp: z.boolean().optional(),
  use: z.array(z.string()).optional(), // proxy-provider ids

  // [S] ssid params
  ssid_params: z
    .object({
      default: z.string().optional(),
      cellular: z.string().optional(),
      wifi: z.record(z.string()).optional(),
    })
    .optional(),
});

export type ProxyGroup = z.infer<typeof proxyGroupSchema>;
