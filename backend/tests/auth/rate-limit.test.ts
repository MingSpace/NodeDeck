import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LoginRateLimitConfig } from "../../src/schemas/config.js";

// 测试不走真实文件系统:loadConfig 被 mock 掉,middleware 集成测试用。
const loadConfigMock = vi.fn();
vi.mock("../../src/storage/config-store.js", () => ({
  loadConfig: () => loadConfigMock(),
}));

// env 用最小桩,避免 zod parse process.env 时缺值
vi.mock("../../src/env.js", () => ({
  env: {
    NODE_ENV: "test",
    PORT: 8080,
    DATA_DIR: "/tmp",
    INITIAL_PASSWORD: "changeme",
    SESSION_SECRET: "test-secret-test-secret",
    LOG_LEVEL: "info",
    LOG_BUFFER_SIZE: 100,
  },
}));

import {
  checkIpLock,
  checkAccountLock,
  recordFail,
  recordSuccess,
  loginRateLimit,
  __resetForTest,
} from "../../src/auth/rate-limit.js";
import { Hono } from "hono";

const DEFAULT_CFG: LoginRateLimitConfig = {
  enabled: true,
  ip_max_fails: 5,
  ip_window_seconds: 300,
  ip_lock_seconds: 1800,
  account_max_fails: 10,
  account_window_seconds: 3600,
  account_lock_seconds: 3600,
};

beforeEach(() => {
  __resetForTest();
  loadConfigMock.mockReset();
});

describe("rate-limit core", () => {
  it("第 N 次失败前 checkIpLock 返回未锁;达到阈值后下一次 check 返回锁定 + Retry-After", () => {
    const ip = "1.2.3.4";
    const account = "admin";
    const now = 1_000_000_000;
    for (let i = 0; i < 4; i++) {
      recordFail(ip, account, DEFAULT_CFG, now + i * 1000);
      expect(checkIpLock(ip, DEFAULT_CFG, now + i * 1000).locked).toBe(false);
    }
    // 第 5 次失败 → 触发锁
    recordFail(ip, account, DEFAULT_CFG, now + 5000);
    const lock = checkIpLock(ip, DEFAULT_CFG, now + 5000);
    expect(lock.locked).toBe(true);
    expect(lock.scope).toBe("ip");
    expect(lock.retryAfterMs).toBeGreaterThan(0);
    expect(lock.retryAfterMs).toBeLessThanOrEqual(DEFAULT_CFG.ip_lock_seconds * 1000);
  });

  it("锁定到期后 checkIpLock 返回 unlocked,且窗口外的旧失败被清理", () => {
    const ip = "1.2.3.4";
    const now = 1_000_000_000;
    for (let i = 0; i < 5; i++) {
      recordFail(ip, "admin", DEFAULT_CFG, now + i);
    }
    expect(checkIpLock(ip, DEFAULT_CFG, now + 5).locked).toBe(true);
    // 锁的起点是最后一次失败时间戳(now+4),lockedUntil = now+4+lock_ms;
    // 加 10_000 保证一定超过
    const afterLock = now + 4 + DEFAULT_CFG.ip_lock_seconds * 1000 + 10_000;
    expect(checkIpLock(ip, DEFAULT_CFG, afterLock).locked).toBe(false);
  });

  it("滑动窗口:第 1 次失败超出 window 后不再计入,需要重新累积阈值次失败才锁", () => {
    const ip = "1.2.3.4";
    const account = "admin";
    const t0 = 1_000_000_000;
    // t0 时刻 4 次失败(未达阈值)
    for (let i = 0; i < 4; i++) recordFail(ip, account, DEFAULT_CFG, t0 + i);
    // 跳到 window + 100s 后:之前 4 次全部超窗
    const t1 = t0 + DEFAULT_CFG.ip_window_seconds * 1000 + 100_000;
    // 此时再来 4 次失败,仍未达阈值
    for (let i = 0; i < 4; i++) recordFail(ip, account, DEFAULT_CFG, t1 + i);
    expect(checkIpLock(ip, DEFAULT_CFG, t1 + 100).locked).toBe(false);
    // 第 5 次才锁
    recordFail(ip, account, DEFAULT_CFG, t1 + 5000);
    expect(checkIpLock(ip, DEFAULT_CFG, t1 + 5000).locked).toBe(true);
  });

  it("成功登录清空计数:失败 4 次 → 成功 → 再失败 4 次仍不锁", () => {
    const ip = "1.2.3.4";
    const account = "admin";
    const now = 1_000_000_000;
    for (let i = 0; i < 4; i++) recordFail(ip, account, DEFAULT_CFG, now + i);
    recordSuccess(ip, account);
    for (let i = 0; i < 4; i++) recordFail(ip, account, DEFAULT_CFG, now + 1000 + i);
    expect(checkIpLock(ip, DEFAULT_CFG, now + 2000).locked).toBe(false);
    expect(checkAccountLock(account, DEFAULT_CFG, now + 2000).locked).toBe(false);
  });

  it("账号维度独立:不同 IP 都打同一账号,达账号阈值后账号锁(IP 各自未锁)", () => {
    const account = "admin";
    const now = 1_000_000_000;
    // 10 个不同 IP,每个失败 1 次 → 总 10 次 → 账号锁
    for (let i = 0; i < DEFAULT_CFG.account_max_fails; i++) {
      const ip = `10.0.0.${i + 1}`;
      recordFail(ip, account, DEFAULT_CFG, now + i);
      expect(checkIpLock(ip, DEFAULT_CFG, now + i).locked).toBe(false);
    }
    const acctLock = checkAccountLock(account, DEFAULT_CFG, now + 100);
    expect(acctLock.locked).toBe(true);
    expect(acctLock.scope).toBe("account");
  });

  it("IP 锁与账号锁互不影响:IP 锁期间换账号仍按账号维度走", () => {
    const ip = "1.2.3.4";
    const now = 1_000_000_000;
    // 用账号 A 把 IP 锁住
    for (let i = 0; i < 5; i++) recordFail(ip, "alice", DEFAULT_CFG, now + i);
    expect(checkIpLock(ip, DEFAULT_CFG, now + 100).locked).toBe(true);
    // 但账号 B 还没被锁
    expect(checkAccountLock("bob", DEFAULT_CFG, now + 100).locked).toBe(false);
  });
});

describe("loginRateLimit middleware", () => {
  function buildApp(): Hono {
    const app = new Hono();
    app.use("/login", loginRateLimit);
    app.post("/login", (c) => c.json({ ok: true }));
    return app;
  }

  it("enabled=false 时直接放行,无视失败计数", async () => {
    loadConfigMock.mockResolvedValue({
      auth: { login_rate_limit: { ...DEFAULT_CFG, enabled: false } },
    });
    // 即使内存里已经锁了
    for (let i = 0; i < 10; i++) {
      recordFail("1.2.3.4", "admin", DEFAULT_CFG, Date.now() + i);
    }
    const app = buildApp();
    const res = await app.request("/login", {
      method: "POST",
      headers: { "x-forwarded-for": "1.2.3.4" },
    });
    expect(res.status).toBe(200);
  });

  it("enabled=true + 当前 IP 已锁定 → 返回 429 + Retry-After header", async () => {
    loadConfigMock.mockResolvedValue({
      auth: { login_rate_limit: DEFAULT_CFG },
    });
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      recordFail("9.9.9.9", "admin", DEFAULT_CFG, now);
    }
    const app = buildApp();
    const res = await app.request("/login", {
      method: "POST",
      headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" },
    });
    expect(res.status).toBe(429);
    const retryAfter = res.headers.get("Retry-After");
    expect(retryAfter).toBeTruthy();
    expect(Number(retryAfter)).toBeGreaterThan(0);
    expect(Number(retryAfter)).toBeLessThanOrEqual(DEFAULT_CFG.ip_lock_seconds);
  });

  it("从 X-Forwarded-For 链首取 IP(代理穿透)", async () => {
    loadConfigMock.mockResolvedValue({
      auth: { login_rate_limit: DEFAULT_CFG },
    });
    const now = Date.now();
    // 把 "1.1.1.1" 锁住
    for (let i = 0; i < 5; i++) recordFail("1.1.1.1", "admin", DEFAULT_CFG, now);
    const app = buildApp();
    // 链首是 1.1.1.1 → 应该被锁
    const blocked = await app.request("/login", {
      method: "POST",
      headers: { "x-forwarded-for": "1.1.1.1, 2.2.2.2" },
    });
    expect(blocked.status).toBe(429);
    // 链首是 2.2.2.2 → 没锁
    const allowed = await app.request("/login", {
      method: "POST",
      headers: { "x-forwarded-for": "2.2.2.2" },
    });
    expect(allowed.status).toBe(200);
  });
});
