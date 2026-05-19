import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { loadConfig, saveConfig } from "../storage/config-store.js";
import {
  createSessionCookie,
  clearSessionCookie,
  verifySessionCookie,
} from "../auth/session.js";
import { requireSession, getClientIp } from "../auth/middleware.js";
import {
  loginRateLimit,
  checkAccountLock,
  recordFail,
  recordSuccess,
} from "../auth/rate-limit.js";
import { logger } from "../logger.js";

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const changePasswordSchema = z.object({
  current_password: z.string().min(1),
  new_password: z.string().min(6),
});

export const authRouter = new Hono();

authRouter.get("/me", async (c) => {
  const session = verifySessionCookie(c.req.header("cookie"));
  if (!session) {
    return c.json({ authenticated: false });
  }
  const cfg = await loadConfig();
  if (cfg.admin.username !== session.username) {
    return c.json({ authenticated: false });
  }
  return c.json({
    authenticated: true,
    username: session.username,
    must_change_password: cfg.admin.must_change_password,
  });
});

authRouter.post("/login", loginRateLimit, async (c) => {
  const body = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: "invalid request" }, 400);
  }
  const cfg = await loadConfig();
  const ip = getClientIp(c);
  const username = body.data.username;
  const rateCfg = cfg.auth.login_rate_limit;

  // 账号维度的锁要在路由内查:middleware 阶段拿不到 body
  if (rateCfg.enabled) {
    const acctLock = checkAccountLock(username, rateCfg);
    if (acctLock.locked && acctLock.retryAfterMs) {
      c.header("Retry-After", String(Math.ceil(acctLock.retryAfterMs / 1000)));
      return c.json({ error: "尝试次数过多,请稍后再试" }, 429);
    }
  }

  const recordFailIfEnabled = () => {
    if (rateCfg.enabled) recordFail(ip, username, rateCfg);
  };

  // 用户名不匹配和密码错误一律走相同的失败分支,不暴露"用户名是否存在"
  if (cfg.admin.username !== username) {
    recordFailIfEnabled();
    logger.info({ ip, username }, "Login failed: unknown username");
    return c.json({ error: "用户名或密码错误" }, 401);
  }
  const ok = await bcrypt.compare(body.data.password, cfg.admin.password_hash);
  if (!ok) {
    recordFailIfEnabled();
    logger.info({ ip, username }, "Login failed: wrong password");
    return c.json({ error: "用户名或密码错误" }, 401);
  }
  if (rateCfg.enabled) recordSuccess(ip, username);
  c.header("Set-Cookie", createSessionCookie(cfg.admin.username));
  return c.json({
    authenticated: true,
    username: cfg.admin.username,
    must_change_password: cfg.admin.must_change_password,
  });
});

authRouter.post("/logout", (c) => {
  c.header("Set-Cookie", clearSessionCookie());
  return c.json({ ok: true });
});

authRouter.post("/change-password", requireSession, async (c) => {
  const body = changePasswordSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: "invalid request" }, 400);
  }
  const cfg = await loadConfig();
  const ok = await bcrypt.compare(body.data.current_password, cfg.admin.password_hash);
  if (!ok) {
    return c.json({ error: "当前密码错误" }, 401);
  }
  const newHash = await bcrypt.hash(body.data.new_password, 10);
  await saveConfig({
    ...cfg,
    admin: {
      ...cfg.admin,
      password_hash: newHash,
      must_change_password: false,
    },
  });
  return c.json({ ok: true });
});
