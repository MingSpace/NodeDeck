import { Hono } from "hono";
import { notificationConfigSchema } from "../schemas/notification.js";
import { loadNotificationConfig, saveNotificationConfig } from "../storage/notification-store.js";
import { notificationConfigPath } from "../storage/paths.js";
import { fileMtimeMs } from "../storage/yaml-io.js";
import { sendTestNotification } from "../notifications/service.js";
import { logger } from "../logger.js";

export const notificationRouter = new Hono();

// updated_at 平铺在配置对象上,前端 draft 会把它剔除后再 PUT 回来;
// 即便漏剔,notificationConfigSchema 非 strict 会 strip 掉,不会写进 yaml。
// 文件不存在(还没保存过,走的是默认配置)时为 null。
notificationRouter.get("/", async (c) => {
  const cfg = await loadNotificationConfig();
  const mtime = await fileMtimeMs(notificationConfigPath());
  return c.json({ ...cfg, updated_at: mtime === null ? null : Math.round(mtime) });
});

notificationRouter.put("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = notificationConfigSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation failed", details: parsed.error.flatten() }, 400);
  }
  const saved = await saveNotificationConfig(parsed.data);
  logger.info(
    {
      barkEnabled: saved.bark.enabled,
      events: Object.fromEntries(
        Object.entries(saved.events).map(([k, v]) => [k, (v as { enabled: boolean }).enabled]),
      ),
    },
    "Notification config updated",
  );
  return c.json(saved);
});

/**
 * 发送测试推送:优先用请求体里的草稿配置(用户还没保存也能先测),
 * 没传 body 就用磁盘上已保存的配置。绕过 enabled 开关与冷却。
 */
notificationRouter.post("/test", async (c) => {
  const body = await c.req.json().catch(() => null);
  let cfg = await loadNotificationConfig();
  if (body) {
    const parsed = notificationConfigSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "validation failed", details: parsed.error.flatten() }, 400);
    }
    cfg = parsed.data;
  }
  if (!cfg.bark.device_key) {
    return c.json({ ok: false, error: "请先填写 Device Key" }, 400);
  }
  const result = await sendTestNotification(cfg);
  return c.json(result, result.ok ? 200 : 502);
});
