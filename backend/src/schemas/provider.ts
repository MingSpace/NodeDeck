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
]);

export const providerSchema = z
  .object({
    id: idSchema,
    name: z.string().min(1),
    type: z.enum(["http", "file", "inline"]),
    url: z.string().url().optional(),
    path: z.string().optional(),
    content: z.string().optional(),
    user_agent: z.string().default("Surge/2400"),
    refresh: refreshSchema.default({ interval_minutes: 60, on_demand: true }),
    parser_hint: parserHintSchema.default("auto"),
    enabled: z.boolean().default(true),
    tags: tagsSchema,
    notes: z.string().optional(),
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
