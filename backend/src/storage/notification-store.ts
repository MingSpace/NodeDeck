import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { notificationConfigPath } from "./paths.js";
import { readYaml, writeYaml } from "./yaml-io.js";
import {
  notificationConfigSchema,
  defaultNotificationConfig,
  type NotificationConfig,
} from "../schemas/notification.js";
import { logger } from "../logger.js";
import { getCache, setCache, invalidate } from "./cache.js";

const CACHE_NS = "notification-config";
const CACHE_KEY = "single";

/**
 * 文件不存在时返回默认配置(bark.enabled=false,所以默认完全静默),
 * 不主动写盘 —— 用户在 Web UI 保存时才落 data/notification.yaml。
 */
export async function loadNotificationConfig(): Promise<NotificationConfig> {
  const path = notificationConfigPath();
  if (existsSync(path)) {
    const stats = await stat(path);
    const cached = getCache<NotificationConfig>(CACHE_NS, CACHE_KEY, stats.mtimeMs);
    if (cached) return cached;
    const raw = await readYaml<unknown>(path);
    if (raw) {
      const result = notificationConfigSchema.safeParse(raw.data);
      if (result.success) {
        setCache<NotificationConfig>(CACHE_NS, CACHE_KEY, raw.mtimeMs, result.data);
        return result.data;
      }
      logger.warn(
        { errors: result.error.flatten() },
        "notification.yaml invalid; falling back to defaults",
      );
    }
  }
  return defaultNotificationConfig();
}

export async function saveNotificationConfig(cfg: NotificationConfig): Promise<NotificationConfig> {
  const parsed = notificationConfigSchema.parse(cfg);
  await writeYaml(notificationConfigPath(), parsed);
  invalidate(CACHE_NS);
  return parsed;
}
