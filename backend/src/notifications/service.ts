import { createHash } from "node:crypto";
import type { Provider } from "../schemas/provider.js";
import type { UserInfo } from "../schemas/userinfo.js";
import type { NotificationConfig } from "../schemas/notification.js";
import { loadNotificationConfig } from "../storage/notification-store.js";
import { sendBark, type BarkSendResult } from "./bark.js";
import { checkUserinfo, formatBytes } from "./checks.js";
import { shouldSend, clearStateByPrefix } from "./state.js";
import { logger } from "../logger.js";

const HOUR_MS = 3_600_000;
/**
 * userinfo 告警每个阶段(即将到期 / 已到期、流量告急 / 已用尽)只推一次:
 * 流量要等下个重置日才恢复,按天重推只是噪音。回到阈值之上(续费 / 流量重置)清状态,下次跌破再推。
 */
const ONCE_PER_STAGE = Number.POSITIVE_INFINITY;
/** /sub 错误与 warnings 按内容 hash 冷却 1h,避免客户端轮询刷屏 */
const SUB_COOLDOWN_MS = 1 * HOUR_MS;

function hashContent(content: string): string {
  return createHash("sha1").update(content).digest("hex").slice(0, 12);
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function loadEnabledConfig(): Promise<NotificationConfig | null> {
  try {
    const cfg = await loadNotificationConfig();
    if (!cfg.bark.enabled || !cfg.bark.device_key) return null;
    return cfg;
  } catch (err) {
    logger.warn({ err }, "Failed to load notification config");
    return null;
  }
}

/**
 * online(http)节点源刷新失败。
 * 冷却:首次失败立即推(成功时状态被清除),持续失败按 cooldown_hours 重推。
 */
export async function notifyProviderRefreshFailed(provider: Provider, errorMsg: string): Promise<void> {
  try {
    if (provider.type !== "http") return;
    const cfg = await loadEnabledConfig();
    if (!cfg || !cfg.events.refresh_failure.enabled) return;
    const cooldownMs = cfg.events.refresh_failure.cooldown_hours * HOUR_MS;
    if (!(await shouldSend(`refresh_failure:${provider.id}`, cooldownMs))) return;
    await sendBark(cfg.bark, {
      title: "节点源刷新失败",
      body: `「${provider.name}」拉取失败:${truncate(errorMsg)}`,
    });
  } catch (err) {
    logger.warn({ err, providerId: provider.id }, "notifyProviderRefreshFailed error");
  }
}

/** online(http)节点源刷新成功但解析出 0 节点。冷却复用 refresh_failure.cooldown_hours。 */
export async function notifyProviderZeroNodes(provider: Provider, reason: string): Promise<void> {
  try {
    if (provider.type !== "http") return;
    const cfg = await loadEnabledConfig();
    if (!cfg || !cfg.events.zero_nodes.enabled) return;
    const cooldownMs = cfg.events.refresh_failure.cooldown_hours * HOUR_MS;
    if (!(await shouldSend(`zero_nodes:${provider.id}`, cooldownMs))) return;
    await sendBark(cfg.bark, {
      // 与 Web UI 通知页的场景名一致
      title: "拉到了订阅,但没有节点",
      body: `「${provider.name}」机场返回了内容,但没认出节点:${truncate(reason)}`,
    });
  } catch (err) {
    logger.warn({ err, providerId: provider.id }, "notifyProviderZeroNodes error");
  }
}

/**
 * 节点源刷新成功后调用:
 * 1. 清除该 provider 的失败/空节点冷却状态(恢复后再次失败会立即推)
 * 2. 若有 userinfo,按阈值检查到期时间与剩余流量
 */
export async function onProviderRefreshSucceeded(provider: Provider, userinfo?: UserInfo): Promise<void> {
  try {
    await clearStateByPrefix(`refresh_failure:${provider.id}`);
    await clearStateByPrefix(`zero_nodes:${provider.id}`);

    if (!userinfo) return;
    const cfg = await loadEnabledConfig();
    if (!cfg || !cfg.events.userinfo_alert.enabled) return;
    const alertCfg = cfg.events.userinfo_alert;
    // provider_ids: null = 全部;否则白名单
    if (alertCfg.provider_ids !== null && !alertCfg.provider_ids.includes(provider.id)) return;

    const result = checkUserinfo(userinfo, {
      expire_days: alertCfg.expire_days,
      traffic_percent: alertCfg.traffic_percent,
    });

    const expireKey = `userinfo:${provider.id}:expire`;
    if (result.expire) {
      if (result.expire.triggered) {
        const expired = result.expire.daysLeft <= 0;
        if (await shouldSend(`${expireKey}:${expired ? "expired" : "soon"}`, ONCE_PER_STAGE)) {
          const dateStr = new Date(result.expire.expireAt).toLocaleDateString("zh-CN");
          await sendBark(cfg.bark, {
            title: expired ? "订阅已到期" : "订阅即将到期",
            body: expired
              ? `「${provider.name}」已于 ${dateStr} 到期,请及时续费`
              : `「${provider.name}」将于 ${dateStr} 到期(剩余 ${Math.max(0, Math.floor(result.expire.daysLeft))} 天)`,
          });
        }
      } else {
        // 恢复阈值之上(续费成功)→ 清状态,下次再跌破立即推。前缀匹配顺带清掉旧版不分阶段的 key
        await clearStateByPrefix(expireKey);
      }
    }

    const trafficKey = `userinfo:${provider.id}:traffic`;
    if (result.traffic) {
      if (result.traffic.triggered) {
        const usedUp = result.traffic.remainingBytes <= 0;
        if (await shouldSend(`${trafficKey}:${usedUp ? "used_up" : "low"}`, ONCE_PER_STAGE)) {
          await sendBark(cfg.bark, {
            title: usedUp ? "订阅流量已用尽" : "订阅流量告急",
            body: usedUp
              ? `「${provider.name}」流量已全部用完(总量 ${formatBytes(result.traffic.totalBytes)})`
              : `「${provider.name}」剩余流量 ${formatBytes(result.traffic.remainingBytes)} / ${formatBytes(result.traffic.totalBytes)}(${result.traffic.percentLeft.toFixed(1)}%)`,
          });
        }
      } else {
        await clearStateByPrefix(trafficKey);
      }
    }
  } catch (err) {
    logger.warn({ err, providerId: provider.id }, "onProviderRefreshSucceeded notification error");
  }
}

/** /sub 订阅生成抛异常(客户端拿到 5xx)。 */
export async function notifySubError(path: string, message: string): Promise<void> {
  try {
    const cfg = await loadEnabledConfig();
    if (!cfg || !cfg.events.sub_error.enabled) return;
    const key = `sub_error:${hashContent(`${path}|${message}`)}`;
    if (!(await shouldSend(key, SUB_COOLDOWN_MS))) return;
    await sendBark(cfg.bark, {
      title: "订阅生成失败",
      body: `${path} 返回 500:${truncate(message)}`,
      level: "timeSensitive",
    });
  } catch (err) {
    logger.warn({ err }, "notifySubError error");
  }
}

/** 订阅生成成功但产生 warnings(链式环、悬空引用、组引用剔除等)。 */
export async function notifySubWarnings(
  profileId: string,
  target: string,
  warnings: string[],
): Promise<void> {
  try {
    if (warnings.length === 0) return;
    const cfg = await loadEnabledConfig();
    if (!cfg || !cfg.events.sub_warnings.enabled) return;
    const key = `sub_warnings:${profileId}:${target}:${hashContent(warnings.join("\n"))}`;
    if (!(await shouldSend(key, SUB_COOLDOWN_MS))) return;
    const shown = warnings.slice(0, 5);
    const more = warnings.length > shown.length ? `\n…等共 ${warnings.length} 条` : "";
    await sendBark(cfg.bark, {
      title: `订阅生成警告(${target})`,
      body: `Profile「${profileId}」:\n${shown.map((w) => truncate(w, 120)).join("\n")}${more}`,
    });
  } catch (err) {
    logger.warn({ err, profileId }, "notifySubWarnings error");
  }
}

/** Web UI「发送测试」:绕过开关与冷却,直接发一条,返回 Bark 结果给前端展示。 */
export async function sendTestNotification(cfg: NotificationConfig): Promise<BarkSendResult> {
  return sendBark(cfg.bark, {
    title: "NodeDeck 测试通知",
    body: `通知配置正常,这是一条测试推送(${new Date().toLocaleString("zh-CN")})`,
  });
}
