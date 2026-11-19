import { z } from "zod";
import { idSchema } from "./common.js";

/**
 * RuleSet represents a logical block of rules (a list URL, an inline list, geosite category, etc.)
 * - core fields: id / name / type / url / payload
 * - Surge 细节: surge_format / surge_flags / surge_reject_options
 */

export const surgeRejectTypeSchema = z.enum([
  "REJECT",
  "REJECT-DROP",
  "REJECT-NO-DROP",
  "REJECT-TINYGIF",
]);

export const surgeFlagsSchema = z.object({
  no_resolve: z.boolean().optional(),
  extended_matching: z.boolean().optional(),
  pre_matching: z.boolean().optional(),
  dns_failed: z.boolean().optional(), // FINAL only
  force_remote_dns: z.boolean().optional(),
});

export const surgeRejectOptionsSchema = z.object({
  type: surgeRejectTypeSchema.default("REJECT"),
  notification_text: z.string().optional(),
  notification_interval: z.number().int().min(1).max(86400).optional(),
});

export const rulesetTypeSchema = z.enum(["remote_url", "inline_list", "geosite", "geoip", "surge_internal"]);

// Surge 内置 ruleset 名(manual.nssurge.com/rule/ruleset.html#internal-ruleset)
// 平台共有(macOS / iOS),非 Mac 独占。
// 注意 LAN 会触发 DNS 查询(文档原文 "this ruleset will trigger a DNS lookup")。
export const surgeInternalRulesetNameSchema = z.enum(["SYSTEM", "LAN"]);

export const surgeFormatSchema = z.enum(["rule_set", "inline_ruleset", "domain_set"]);

export const rulesetSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    policy: z.string().optional(),

    type: rulesetTypeSchema.default("remote_url"),
    url: z.string().url().optional(),
    payload: z.array(z.string()).optional(),

    // type=geosite:Surge 没有原生 GEOSITE,生成时 payload 展开为内联规则,否则 url 走 DOMAIN-SET。
    // 当 type=geoip 时,优先使用此国家代码(如 "CN"/"US")作为 GEOIP 关键字;缺省时回退到 id。
    geoip_country_code: z.string().min(1).optional(),

    // 当 type=surge_internal 时,指定 Surge 内置 ruleset 名(SYSTEM / LAN)。
    surge_internal_name: surgeInternalRulesetNameSchema.optional(),

    surge_flags: surgeFlagsSchema.optional(),
    surge_reject_options: surgeRejectOptionsSchema.optional(),

    surge_format: surgeFormatSchema.default("rule_set"),

    update_interval: z.number().int().min(60).default(86400),
  })
  .superRefine((r, ctx) => {
    if (r.type === "remote_url" && !r.url) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "remote_url type requires `url`", path: ["url"] });
    }
    if (r.type === "inline_list" && (!r.payload || r.payload.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "inline_list type requires non-empty `payload`",
        path: ["payload"],
      });
    }
    if (r.type === "surge_internal" && !r.surge_internal_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "surge_internal type requires `surge_internal_name` (SYSTEM or LAN)",
        path: ["surge_internal_name"],
      });
    }
  });

export type RuleSet = z.infer<typeof rulesetSchema>;
