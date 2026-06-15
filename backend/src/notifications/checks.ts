import type { UserInfo } from "../schemas/userinfo.js";

export interface ExpireCheck {
  /** 剩余天数(可为负,表示已过期) */
  daysLeft: number;
  expireAt: number;
  triggered: boolean;
}

export interface TrafficCheck {
  /** 剩余百分比 0-100(可为 0,表示已用尽) */
  percentLeft: number;
  remainingBytes: number;
  totalBytes: number;
  triggered: boolean;
}

export interface UserinfoCheckResult {
  expire?: ExpireCheck;
  traffic?: TrafficCheck;
}

/**
 * 阈值检查:到期剩余天数 <= expire_days 或 剩余流量百分比 <= traffic_percent 时触发。
 * expire/total 为 0 表示上游未提供该信息,对应维度跳过(返回 undefined)。
 */
export function checkUserinfo(
  userinfo: UserInfo,
  thresholds: { expire_days: number; traffic_percent: number },
  now = Date.now(),
): UserinfoCheckResult {
  const result: UserinfoCheckResult = {};

  if (userinfo.expire > 0) {
    const expireAt = userinfo.expire * 1000;
    const daysLeft = (expireAt - now) / 86_400_000;
    result.expire = {
      daysLeft,
      expireAt,
      triggered: daysLeft <= thresholds.expire_days,
    };
  }

  if (userinfo.total > 0) {
    const used = userinfo.upload + userinfo.download;
    const remainingBytes = Math.max(0, userinfo.total - used);
    const percentLeft = (remainingBytes / userinfo.total) * 100;
    result.traffic = {
      percentLeft,
      remainingBytes,
      totalBytes: userinfo.total,
      triggered: percentLeft <= thresholds.traffic_percent,
    };
  }

  return result;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}
