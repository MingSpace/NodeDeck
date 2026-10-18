import type { Provider } from "../schemas/provider.js";
import type { UserInfo } from "../schemas/userinfo.js";
import type { InfoNodeQuota } from "../parsers/info-node-extract.js";

/** 判定要用到的 cache 字段(readProviderCache 的结果可直接传) */
export interface QuotaSources {
  userinfo?: UserInfo;
  info_quota?: InfoNodeQuota;
}

export type QuotaReason = "expired" | "manual_exhausted" | "traffic_exhausted";

export interface ProviderQuotaStatus {
  /** 生成订阅时是否排除该源(已计入 auto_exclude 开关) */
  excluded: boolean;
  /** 命中的原因;auto_exclude 关闭时仍给出,供 UI 展示 */
  reason?: QuotaReason;
  /** 预计恢复时间(ms);undefined = 无法预估(在线源等下次刷新 / 过期等续费) */
  restore_at?: number;
  /** 流量(total=0 视为不限量,不给出) */
  traffic?: { used: number; total: number };
  traffic_source?: "upstream" | "info_node";
  expire_at?: number;
  expire_source?: "upstream" | "manual" | "info_node";
  next_reset_at?: number;
}

/** "YYYY-MM-DD" → 进程本地时区当天零点(ms)。schema 已保证格式与日期合法。 */
export function parseLocalDate(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** 下一个重置日零点(严格晚于 now)。当月没有 reset_day 这一天时取月末。 */
export function nextResetAt(resetDay: number, now = Date.now()): number {
  const base = new Date(now);
  for (let offset = 0; offset <= 1; offset++) {
    const year = base.getFullYear();
    const month = base.getMonth() + offset;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const candidate = new Date(year, month, Math.min(resetDay, lastDay)).getTime();
    if (candidate > now) return candidate;
  }
  // offset=1 的候选一定在下个月,必然 > now;走到这里说明逻辑被改坏了
  throw new Error("unreachable: nextResetAt");
}

/**
 * 判定节点源当前是否因流量 / 到期需要排除。纯函数,所有输入来自 provider yaml + cache,
 * 不维护任何内存状态,所以「刷新日自动恢复」只是时间过了重新算一遍的结果。
 *
 * 优先级:过期 > 手动标记用完 > 流量用完。各项数据的来源:
 * - 到期:上游 Subscription-UserInfo > 手填 quota.expire > 订阅里的信息节点
 * - 流量:上游 userinfo > 信息节点;**离线源(inline)的信息节点流量不用**——那是导入时的快照,早已过时
 * - 重置日:手填 quota.reset_day > 信息节点倒计时(同样只认在线源)
 * - 离线源没有实时流量,用完只能靠 quota.exhausted_until 手动标记,到日子自动恢复
 */
export function evaluateProviderQuota(
  provider: Provider,
  sources: QuotaSources | null | undefined,
  now = Date.now(),
): ProviderQuotaStatus {
  const quota = provider.quota;
  const userinfo = sources?.userinfo;
  const info = sources?.info_quota;
  const live = provider.type !== "inline";
  const status: ProviderQuotaStatus = { excluded: false };

  if (userinfo && userinfo.total > 0) {
    status.traffic = { used: userinfo.upload + userinfo.download, total: userinfo.total };
    status.traffic_source = "upstream";
  } else if (live && info?.traffic) {
    status.traffic = info.traffic;
    status.traffic_source = "info_node";
  }
  if (userinfo && userinfo.expire > 0) {
    status.expire_at = userinfo.expire * 1000;
    status.expire_source = "upstream";
  } else if (quota?.expire) {
    status.expire_at = parseLocalDate(quota.expire);
    status.expire_source = "manual";
  } else if (info?.expire) {
    status.expire_at = parseLocalDate(info.expire);
    status.expire_source = "info_node";
  }
  if (quota?.reset_day) status.next_reset_at = nextResetAt(quota.reset_day, now);
  else if (live && info?.reset_at !== undefined && info.reset_at > now) status.next_reset_at = info.reset_at;

  const manualUntil = quota?.exhausted_until ? parseLocalDate(quota.exhausted_until) : undefined;

  if (status.expire_at !== undefined && status.expire_at <= now) {
    status.reason = "expired";
  } else if (manualUntil !== undefined && manualUntil > now) {
    status.reason = "manual_exhausted";
    status.restore_at = manualUntil;
  } else if (status.traffic && status.traffic.used >= status.traffic.total) {
    status.reason = "traffic_exhausted";
    status.restore_at = status.next_reset_at;
  }

  status.excluded = status.reason !== undefined && quota?.auto_exclude !== false;
  return status;
}

const REASON_LABEL: Record<QuotaReason, string> = {
  expired: "已到期",
  manual_exhausted: "流量已用完(手动标记)",
  traffic_exhausted: "流量已用完",
};

function formatLocalDate(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function describeQuotaExclusion(name: string, status: ProviderQuotaStatus): string {
  const reason = status.reason ? REASON_LABEL[status.reason] : "配额不可用";
  const restore =
    status.restore_at !== undefined
      ? `,预计 ${formatLocalDate(status.restore_at)} 恢复`
      : status.reason === "traffic_exhausted"
        ? ",上游流量重置后下次刷新自动恢复"
        : "";
  return `节点源「${name}」${reason},已从订阅中临时排除${restore}`;
}
