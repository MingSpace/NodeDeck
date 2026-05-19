import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
// @ts-ignore
import bcrypt from "bcryptjs";

// mock storage,完全用内存假数据,不碰真实 yaml
const loadConfigMock = vi.fn();
const saveConfigMock = vi.fn();
vi.mock("../../src/storage/config-store.js", () => ({
  loadConfig: () => loadConfigMock(),
  saveConfig: (cfg: unknown) => {
    saveConfigMock(cfg);
    return Promise.resolve(cfg);
  },
}));
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

import { authRouter } from "../../src/routes/auth.js";
import { __resetForTest as resetRateLimit } from "../../src/auth/rate-limit.js";

function buildApp(): Hono {
  const app = new Hono();
  app.route("/api/auth", authRouter);
  return app;
}

async function makeConfig(opts: { enabled?: boolean; ip_max_fails?: number } = {}) {
  return {
    admin: {
      username: "admin",
      password_hash: await bcrypt.hash("correctpw", 4),
      must_change_password: false,
    },
    ip_allowlist: [],
    public_base_url: undefined,
    default_user_agent: "Surge/2400",
    auth: {
      login_rate_limit: {
        enabled: opts.enabled ?? true,
        ip_max_fails: opts.ip_max_fails ?? 5,
        ip_window_seconds: 300,
        ip_lock_seconds: 1800,
        account_max_fails: 10,
        account_window_seconds: 3600,
        account_lock_seconds: 3600,
      },
    },
  };
}

beforeEach(() => {
  resetRateLimit();
  loadConfigMock.mockReset();
  saveConfigMock.mockReset();
});

describe("POST /api/auth/login 端到端", () => {
  it("正确密码返回 200 + Set-Cookie", async () => {
    loadConfigMock.mockResolvedValue(await makeConfig());
    const app = buildApp();
    const res = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.1.1.1" },
      body: JSON.stringify({ username: "admin", password: "correctpw" }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toMatch(/nodedeck_session=/);
  });

  it("错误密码 5 次后,第 6 次返回 429 + Retry-After", async () => {
    loadConfigMock.mockResolvedValue(await makeConfig());
    const app = buildApp();
    const ip = "2.2.2.2";
    for (let i = 0; i < 5; i++) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ username: "admin", password: "wrongpw" }),
      });
      expect(res.status).toBe(401);
    }
    const blocked = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ username: "admin", password: "correctpw" }),
    });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("Retry-After"))).toBeGreaterThan(0);
  });

  it("enabled=false 时,密码错 20 次也不会锁定", async () => {
    loadConfigMock.mockResolvedValue(await makeConfig({ enabled: false }));
    const app = buildApp();
    for (let i = 0; i < 20; i++) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "3.3.3.3" },
        body: JSON.stringify({ username: "admin", password: "wrongpw" }),
      });
      expect(res.status).toBe(401);
    }
  });

  it("用户名不匹配也计入失败次数(防用户名枚举)", async () => {
    loadConfigMock.mockResolvedValue(await makeConfig({ ip_max_fails: 3 }));
    const app = buildApp();
    const ip = "4.4.4.4";
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ username: "nonexistent", password: "x" }),
      });
      expect(res.status).toBe(401);
    }
    // 第 4 次哪怕换成正确账号也得吃锁
    const blocked = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ username: "admin", password: "correctpw" }),
    });
    expect(blocked.status).toBe(429);
  });

  it("成功登录后失败计数清零", async () => {
    loadConfigMock.mockResolvedValue(await makeConfig());
    const app = buildApp();
    const ip = "5.5.5.5";
    // 失败 4 次
    for (let i = 0; i < 4; i++) {
      await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ username: "admin", password: "wrongpw" }),
      });
    }
    // 成功一次
    const ok = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify({ username: "admin", password: "correctpw" }),
    });
    expect(ok.status).toBe(200);
    // 再失败 4 次,仍不应锁
    for (let i = 0; i < 4; i++) {
      const res = await app.request("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({ username: "admin", password: "wrongpw" }),
      });
      expect(res.status).toBe(401);
    }
  });
});
