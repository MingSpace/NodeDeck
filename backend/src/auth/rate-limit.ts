import type { MiddlewareHandler } from "hono";
import { loadConfig } from "../storage/config-store.js";
import type { LoginRateLimitConfig } from "../schemas/config.js";
import { logger } from "../logger.js";
import { getClientIp } from "./middleware.js";

/**
 * 登录失败限流 + 封禁。
 *
 * 设计:
 * - 内存 Map(进程重启清空),单用户自用场景足够,不引入 redis / 文件持久化
 * - 阈值从 config.yaml 实时读取,改了立刻生效(chokidar 已经在监听)
 * - 双维度独立计数:IP 维度防同一来源撞库,账号维度防分布式 IP 池打同一账号
 * - 滑动窗口:每次 check 顺手清理超窗的旧时间戳,避免内存膨胀
 * - 硬上限 10000 条记录兜底,超出按 FIFO 丢最旧
 */

interface FailRecord {
  fails: number[];
  lockedUntil?: number;
}

const MAX_ENTRIES = 10000;

const ipMap = new Map<string, FailRecord>();
const accountMap = new Map<string, FailRecord>();

export interface LockResult {
  locked: boolean;
  /** 剩余锁定毫秒数;locked=true 时一定有值 */
  retryAfterMs?: number;
  scope?: "ip" | "account";
}

function pruneAndCheckLock(
  record: FailRecord | undefined,
  now: number,
  windowMs: number,
): { record: FailRecord | undefined; locked: boolean; retryAfterMs?: number } {
  if (!record) return { record: undefined, locked: false };
  if (record.lockedUntil && record.lockedUntil > now) {
    return { record, locked: true, retryAfterMs: record.lockedUntil - now };
  }
  const cutoff = now - windowMs;
  record.fails = record.fails.filter((t) => t > cutoff);
  // 清空就别留空壳
  if (record.fails.length === 0 && (!record.lockedUntil || record.lockedUntil <= now)) {
    return { record: undefined, locked: false };
  }
  return { record, locked: false };
}

function trimMap(map: Map<string, FailRecord>): void {
  if (map.size <= MAX_ENTRIES) return;
  // Map 迭代顺序 = 插入顺序,直接丢前几个
  const overflow = map.size - MAX_ENTRIES;
  const it = map.keys();
  for (let i = 0; i < overflow; i++) {
    const next = it.next();
    if (next.done) break;
    map.delete(next.value);
  }
}

/** 仅查 IP 维度的锁(middleware 用);body 尚未解析,拿不到账号。 */
export function checkIpLock(ip: string, cfg: LoginRateLimitConfig, now = Date.now()): LockResult {
  const windowMs = cfg.ip_window_seconds * 1000;
  const probe = pruneAndCheckLock(ipMap.get(ip), now, windowMs);
  if (probe.record === undefined) ipMap.delete(ip);
  else ipMap.set(ip, probe.record);
  if (probe.locked) return { locked: true, retryAfterMs: probe.retryAfterMs, scope: "ip" };
  return { locked: false };
}

/** 仅查账号维度的锁。 */
export function checkAccountLock(
  account: string,
  cfg: LoginRateLimitConfig,
  now = Date.now(),
): LockResult {
  const windowMs = cfg.account_window_seconds * 1000;
  const probe = pruneAndCheckLock(accountMap.get(account), now, windowMs);
  if (probe.record === undefined) accountMap.delete(account);
  else accountMap.set(account, probe.record);
  if (probe.locked) return { locked: true, retryAfterMs: probe.retryAfterMs, scope: "account" };
  return { locked: false };
}

/**
 * 记录一次失败,两个维度都累加。达到阈值时设置 lockedUntil。
 * 返回是否刚刚触发了锁(供路由层日志记录用,不强制使用)。
 */
export function recordFail(
  ip: string,
  account: string,
  cfg: LoginRateLimitConfig,
  now = Date.now(),
): { ipLocked: boolean; accountLocked: boolean } {
  const ipLocked = bumpAndMaybeLock(
    ipMap,
    ip,
    now,
    cfg.ip_window_seconds * 1000,
    cfg.ip_max_fails,
    cfg.ip_lock_seconds * 1000,
  );
  const accountLocked = bumpAndMaybeLock(
    accountMap,
    account,
    now,
    cfg.account_window_seconds * 1000,
    cfg.account_max_fails,
    cfg.account_lock_seconds * 1000,
  );
  trimMap(ipMap);
  trimMap(accountMap);
  if (ipLocked) {
    logger.warn(
      { ip, scope: "ip", lock_seconds: cfg.ip_lock_seconds },
      "Login locked: too many failures from IP",
    );
  }
  if (accountLocked) {
    logger.warn(
      { account, scope: "account", lock_seconds: cfg.account_lock_seconds },
      "Login locked: too many failures for account",
    );
  }
  return { ipLocked, accountLocked };
}

function bumpAndMaybeLock(
  map: Map<string, FailRecord>,
  key: string,
  now: number,
  windowMs: number,
  maxFails: number,
  lockMs: number,
): boolean {
  const existing = map.get(key);
  const cutoff = now - windowMs;
  const kept = existing ? existing.fails.filter((t) => t > cutoff) : [];
  kept.push(now);
  // 触发锁:窗口内累计次数 >= 阈值
  const shouldLock = kept.length >= maxFails;
  const next: FailRecord = {
    fails: kept,
    lockedUntil: shouldLock ? now + lockMs : existing?.lockedUntil,
  };
  map.set(key, next);
  return shouldLock && (!existing?.lockedUntil || existing.lockedUntil <= now);
}

/** 成功登录后清空该 IP + 账号的失败记录(包括 lockedUntil)。 */
export function recordSuccess(ip: string, account: string): void {
  ipMap.delete(ip);
  accountMap.delete(account);
}

/** 仅供测试使用:重置所有内存状态。 */
export function __resetForTest(): void {
  ipMap.clear();
  accountMap.clear();
}

/**
 * 登录路由前置 middleware:仅查 IP 锁(账号锁要等 body 解析后在路由内再查)。
 * 命中锁返回 429 + Retry-After header,符合 RFC 6585。
 */
export const loginRateLimit: MiddlewareHandler = async (c, next) => {
  const cfg = await loadConfig();
  if (!cfg.auth.login_rate_limit.enabled) return next();
  const ip = getClientIp(c);
  const lock = checkIpLock(ip, cfg.auth.login_rate_limit);
  if (lock.locked && lock.retryAfterMs) {
    c.header("Retry-After", String(Math.ceil(lock.retryAfterMs / 1000)));
    return c.json({ error: "尝试次数过多,请稍后再试" }, 429);
  }
  await next();
};
