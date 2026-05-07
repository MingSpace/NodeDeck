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
 * never:轮询无意义,给最大值(1 周)。
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
      return "永不刷新";
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

// 兼容老 yaml: { interval_minutes: number, on_demand: boolean } → { interval: enum }
// on_demand: false 在老实现中其实未生效,但 UI 上有,用户原意是"不要按需刷新",
// 在新语义下最贴近"never"(永久缓存)。on_demand: true / 缺失则按 interval_minutes 桶映射。
export const refreshSchema = z.preprocess(
  (raw) => {
    if (typeof raw !== "object" || raw === null) return raw;
    const r = raw as Record<string, unknown>;
    if (typeof r.interval === "string") return { interval: r.interval };
    if (typeof r.interval_minutes === "number") {
      const m = r.interval_minutes;
      const onDemand = r.on_demand !== false;
      if (!onDemand) return { interval: "never" };
      if (m <= 240) return { interval: "4h" };
      if (m <= 720) return { interval: "12h" };
      if (m <= 1440) return { interval: "24h" };
      return { interval: "1week" };
    }
    return r;
  },
  z.object({
    interval: refreshIntervalSchema.default("12h"),
  }),
);

export const targetSchema = z.enum(["clash", "surge"]);
export type Target = z.infer<typeof targetSchema>;
