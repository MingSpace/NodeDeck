import { z } from "zod";

// Bark 推送配置。API 见 https://bark.day.app / https://github.com/Finb/bark-server
// (POST {server}/push,JSON body: device_key / title / body / level / group / sound ...)
export const barkLevelSchema = z.enum(["active", "timeSensitive", "critical", "passive"]);

export const barkConfigSchema = z
  .object({
    enabled: z.boolean().default(false),
    server: z.string().url().default("https://api.day.app"),
    device_key: z.string().default(""),
    // 留空 = 客户端默认铃声
    sound: z.string().default(""),
    group: z.string().default("NodeDeck"),
    level: barkLevelSchema.default("active"),
  })
  .default({});

export const refreshFailureEventSchema = z
  .object({
    enabled: z.boolean().default(true),
    // 持续失败时的重复推送间隔;首次失败(ok→失败 切换)总是立即推。
    cooldown_hours: z.number().min(1).max(168).default(6),
  })
  .default({});

export const zeroNodesEventSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .default({});

export const userinfoAlertEventSchema = z
  .object({
    enabled: z.boolean().default(true),
    // null = 所有启用的 http 源都检查;否则只检查白名单内的 provider id
    provider_ids: z.array(z.string()).nullable().default(null),
    expire_days: z.number().min(0).max(60).default(3),
    traffic_percent: z.number().min(0).max(100).default(5),
  })
  .default({});

export const subErrorEventSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .default({});

export const subWarningsEventSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .default({});

export const notificationEventsSchema = z
  .object({
    refresh_failure: refreshFailureEventSchema,
    zero_nodes: zeroNodesEventSchema,
    userinfo_alert: userinfoAlertEventSchema,
    sub_error: subErrorEventSchema,
    sub_warnings: subWarningsEventSchema,
  })
  .default({});

export const notificationConfigSchema = z.object({
  bark: barkConfigSchema,
  events: notificationEventsSchema,
});

export type BarkConfig = z.infer<typeof barkConfigSchema>;
export type BarkLevel = z.infer<typeof barkLevelSchema>;
export type NotificationEvents = z.infer<typeof notificationEventsSchema>;
export type NotificationConfig = z.infer<typeof notificationConfigSchema>;

export function defaultNotificationConfig(): NotificationConfig {
  return notificationConfigSchema.parse({});
}
