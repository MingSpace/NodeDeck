import { z } from "zod";
import { idSchema, tokenSchema, renameRuleSchema, namedRefSchema } from "./common.js";
import { selectorSchema } from "./proxy-group.js";

export const userinfoModeSchema = z.enum(["primary", "sum"]);

export const nodeFilterSchema = z.object({
  include_regex: z.string().optional(),
  exclude_regex: z.string().optional(),
  rename_rules: z.array(renameRuleSchema).default([]),
  exclude_types: z.array(z.string()).default([]),
  // 开启后输出节点按地区聚类:HK→TW→JP→SG→US→其他地区字母序→未识别地区,
  // 同地区内保持原始顺序(见 generators/node-sort.ts)
  sort_by_region: z.boolean().default(false),
});

export const ruleModuleRefSchema = z.union([
  z.object({
    ref: idSchema,
    policy: z.string(),
    enabled: z.boolean().default(true),
    note: z.string().optional(),
  }),
  z.object({
    final: z.string(),
    dns_failed: z.boolean().optional(),
  }),
  z.object({
    geoip_cn: z.boolean().default(true),
    policy: z.string(),
  }),
]);

export const chainRuleSchema = z.object({
  selector: selectorSchema,
  via: namedRefSchema,
  comment: z.string().optional(),
});

export const profileSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  token: tokenSchema,

  // node sources
  providers: z.array(idSchema).default([]),

  // node filtering / renaming
  node_filter: nodeFilterSchema.default({}),

  // chain proxy
  chain_rules: z.array(chainRuleSchema).default([]),

  // groups
  proxy_groups: z.array(idSchema).default([]),

  // rules
  rule_modules: z.array(ruleModuleRefSchema).default([]),

  // surge-only
  surge_modules: z.array(idSchema).default([]),

  // general
  general_preset: idSchema.optional(),

  // userinfo aggregation
  // enabled=false 时 /sub 完全跳过 aggregateUserInfo,不写 Subscription-UserInfo / X-NodeDeck-Userinfo-*
  userinfo: z
    .object({
      enabled: z.boolean().default(false),
      mode: userinfoModeSchema.default("sum"),
      primary_provider: idSchema.optional(),
      expose_per_provider_headers: z.boolean().default(true),
    })
    .default({ enabled: false, mode: "sum", expose_per_provider_headers: true }),

  // surge managed-config
  managed_config_url: z.union([z.literal("auto"), z.literal("none"), z.string().url()]).default("auto"),
  managed_config_interval: z.number().int().min(60).default(86400),
  managed_config_strict: z.boolean().default(false),

  // emit clash format details
  clash_options: z
    .object({
      use_proxy_providers: z.boolean().default(false),
      flag: z.enum(["mihomo", "stash"]).default("mihomo"),
      group_style: z.enum(["block", "flow"]).default("flow"),
    })
    .default({ use_proxy_providers: false, flag: "mihomo", group_style: "flow" }),
});

export type Profile = z.infer<typeof profileSchema>;
