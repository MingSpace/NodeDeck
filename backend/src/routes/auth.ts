import { Hono } from "hono";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { loadConfig, saveConfig } from "../storage/config-store.js";
import {
  createSessionCookie,
  clearSessionCookie,
  verifySessionCookie,
} from "../auth/session.js";
import { requireSession } from "../auth/middleware.js";

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

authRouter.post("/login", async (c) => {
  const body = loginSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) {
    return c.json({ error: "invalid request" }, 400);
  }
  const cfg = await loadConfig();
  if (cfg.admin.username !== body.data.username) {
    return c.json({ error: "用户名或密码错误" }, 401);
  }
  const ok = await bcrypt.compare(body.data.password, cfg.admin.password_hash);
  if (!ok) {
    return c.json({ error: "用户名或密码错误" }, 401);
  }
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
