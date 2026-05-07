import { useEffect, useState } from "react";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function formatRelativeTime(input: number | Date, now: number = Date.now()): string {
  const ts = typeof input === "number" ? input : input.getTime();
  const diff = now - ts;
  const abs = Math.abs(diff);
  const future = diff < 0;

  if (abs < 5 * SECOND) return "刚刚";
  if (abs < MINUTE) {
    const v = Math.floor(abs / SECOND);
    return future ? `${v} 秒后` : `${v} 秒前`;
  }
  if (abs < HOUR) {
    const v = Math.floor(abs / MINUTE);
    return future ? `${v} 分钟后` : `${v} 分钟前`;
  }
  if (abs < DAY) {
    const v = Math.floor(abs / HOUR);
    return future ? `${v} 小时后` : `${v} 小时前`;
  }
  if (abs < WEEK) {
    const v = Math.floor(abs / DAY);
    return future ? `${v} 天后` : `${v} 天前`;
  }
  if (abs < MONTH) {
    const v = Math.floor(abs / WEEK);
    return future ? `${v} 周后` : `${v} 周前`;
  }
  if (abs < YEAR) {
    const v = Math.floor(abs / MONTH);
    return future ? `${v} 个月后` : `${v} 个月前`;
  }
  const v = Math.floor(abs / YEAR);
  return future ? `${v} 年后` : `${v} 年前`;
}

export function formatAbsoluteTime(input: number | Date): string {
  const d = typeof input === "number" ? new Date(input) : input;
  return d.toLocaleString();
}

// 选择和当前差值匹配的轮询粒度,避免无意义高频 re-render:
// < 1 分钟 → 5 秒;< 1 小时 → 30 秒;< 1 天 → 5 分钟;否则 1 小时。
function pickInterval(diff: number): number {
  const abs = Math.abs(diff);
  if (abs < MINUTE) return 5 * SECOND;
  if (abs < HOUR) return 30 * SECOND;
  if (abs < DAY) return 5 * MINUTE;
  return HOUR;
}

export function useRelativeTime(input: number | Date | null | undefined): string {
  const [, setTick] = useState(0);

  useEffect(() => {
    if (input == null) return;
    const ts = typeof input === "number" ? input : input.getTime();
    const id = window.setInterval(() => {
      setTick((n) => n + 1);
    }, pickInterval(Date.now() - ts));
    return () => window.clearInterval(id);
  }, [input]);

  if (input == null) return "";
  return formatRelativeTime(input);
}
