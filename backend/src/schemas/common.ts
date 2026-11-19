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

export const refreshIntervalSchema = z.enum([
  "never",
  "4h",
  "12h",
  "24h",
  "1week",
  "on_request",
]);
export type RefreshInterval = z.infer<typeof refreshIntervalSchema>;

// null = 不调度(never);0 = 每次请求触发(on_request);其它为周期分钟数。
export const REFRESH_INTERVAL_MINUTES: Record<RefreshInterval, number | null> = {
  never: null,
  "4h": 240,
  "12h": 720,
  "24h": 1440,
  "1week": 10080,
  on_request: 0,
};

export function refreshIntervalLabel(interval: RefreshInterval): string {
  switch (interval) {
    case "never":
      return "手动刷新";
    case "1week":
      return "每周";
    case "24h":
      return "每 24 小时";
    case "12h":
      return "每 12 小时";
    case "4h":
      return "每 4 小时";
    case "on_request":
      return "每次调用时";
  }
}

export const refreshSchema = z.object({
  interval: refreshIntervalSchema.default("12h"),
});
