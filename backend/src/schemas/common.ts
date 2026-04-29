import { z } from "zod";

export const idSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9_-]+$/, "id must be alphanumeric / underscore / dash");

export const slugSchema = idSchema;

export const tokenSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/);

export const namedRefSchema = z.string().min(1);

export const regionCodeSchema = z
  .string()
  .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2");

export const tagsSchema = z.array(z.string().min(1)).default([]);

export const renameRuleSchema = z.object({
  pattern: z.string().min(1),
  replace: z.string().default(""),
  flags: z.string().optional(),
});

export const refreshSchema = z.object({
  interval_minutes: z.number().int().min(1).max(60 * 24 * 30).default(60),
  on_demand: z.boolean().default(true),
});

export const targetSchema = z.enum(["clash", "surge"]);
export type Target = z.infer<typeof targetSchema>;
