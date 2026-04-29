import { z } from "zod";
import { idSchema } from "./common.js";

/**
 * RuleSet represents a logical block of rules (a list URL, an inline list, geosite category, etc.)
 * - [CS] core fields (id/name/type/behavior/url/payload)
 * - [C]  format (yaml/text/mrs)
 * - [S]  surge_flags, surge_reject_options
 */

export const surgeRejectTypeSchema = z.enum([
  "REJECT", // [CS] (clash also has)
  "REJECT-DROP", // [S]
  "REJECT-NO-DROP", // [S]
  "REJECT-TINYGIF", // [S]
]);

export const surgeFlagsSchema = z.object({
  no_resolve: z.boolean().optional(), // [CS] both support
  extended_matching: z.boolean().optional(), // [S]
  pre_matching: z.boolean().optional(), // [S]
  dns_failed: z.boolean().optional(), // [S] FINAL only
  force_remote_dns: z.boolean().optional(), // [S]
});

export const surgeRejectOptionsSchema = z.object({
  type: surgeRejectTypeSchema.default("REJECT"),
  notification_text: z.string().optional(),
  notification_interval: z.number().int().min(1).max(86400).optional(),
});

export const rulesetTypeSchema = z.enum(["remote_url", "inline_list", "geosite", "geoip"]);

export const rulesetBehaviorSchema = z.enum(["domain", "ipcidr", "classical"]);

export const rulesetFormatSchema = z.enum(["yaml", "text", "mrs"]); // [C]

export const clashFormatSchema = z.enum(["rule_provider", "inline"]); // [C]
export const surgeFormatSchema = z.enum(["rule_set", "inline_ruleset", "domain_set"]); // [S]

export const rulesetSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    policy: z.string().optional(),

    type: rulesetTypeSchema.default("remote_url"),
    url: z.string().url().optional(),
    payload: z.array(z.string()).optional(),
    behavior: rulesetBehaviorSchema.default("classical"),
    format: rulesetFormatSchema.default("yaml"),

    surge_flags: surgeFlagsSchema.optional(),
    surge_reject_options: surgeRejectOptionsSchema.optional(),

    clash_format: clashFormatSchema.default("rule_provider"),
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
  });

export type RuleSet = z.infer<typeof rulesetSchema>;
