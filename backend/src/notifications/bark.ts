import type { BarkConfig, BarkLevel } from "../schemas/notification.js";
import { logger } from "../logger.js";

export interface BarkMessage {
  title: string;
  body: string;
  /** 覆盖配置里的全局 level(如订阅生成 5xx 用 timeSensitive) */
  level?: BarkLevel;
  url?: string;
}

export interface BarkSendResult {
  ok: boolean;
  status?: number;
  error?: string;
}

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * 发送 Bark 推送(POST {server}/push,JSON V2 API)。
 * 任何失败只 log warn 并返回 ok=false,绝不抛出 —— 通知是旁路,不允许影响主流程。
 */
export async function sendBark(cfg: BarkConfig, msg: BarkMessage): Promise<BarkSendResult> {
  if (!cfg.device_key) {
    return { ok: false, error: "device_key 未配置" };
  }
  const endpoint = `${cfg.server.replace(/\/+$/, "")}/push`;
  const payload: Record<string, string> = {
    device_key: cfg.device_key,
    title: msg.title,
    body: msg.body,
    level: msg.level ?? cfg.level,
  };
  if (cfg.group) payload.group = cfg.group;
  if (cfg.sound) payload.sound = cfg.sound;
  if (msg.url) payload.url = msg.url;

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const error = `Bark 响应 ${res.status}: ${text.slice(0, 200)}`;
      logger.warn({ status: res.status, title: msg.title }, "Bark push failed");
      return { ok: false, status: res.status, error };
    }
    logger.info({ title: msg.title }, "Bark push sent");
    return { ok: true, status: res.status };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.warn({ err, title: msg.title }, "Bark push request error");
    return { ok: false, error };
  }
}
