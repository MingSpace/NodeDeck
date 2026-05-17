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

/**
 * 给客户端 / 下游(Profile-Update-Interval, mihomo proxy-provider interval)用的秒数。
 * never(手动刷新):客户端轮询无意义,给最大值(1 周)。
 * on_request:客户端可以频繁轮询,服务端会在 /sub 路径上即时拉机场,这里给 1h 让客户端别太懒。
 */
export function refreshIntervalToSeconds(interval: RefreshInterval): number {
  switch (interval) {
    case "never":
      return 604800;
    case "1week":
      return 604800;
    case "24h":
      return 86400;
    case "12h":
      return 43200;
    case "4h":
      return 14400;
    case "on_request":
      return 3600;
  }
}

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

export const targetSchema = z.enum(["clash", "surge"]);
export type Target = z.infer<typeof targetSchema>;
