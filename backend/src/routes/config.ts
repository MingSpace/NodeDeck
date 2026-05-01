import { Hono } from "hono";
import { z } from "zod";
import { loadConfig, saveConfig } from "../storage/config-store.js";

export const configRouter = new Hono();

const updateSchema = z.object({
  ip_allowlist: z.array(z.string()).optional(),
  public_base_url: z.string().url().optional().or(z.literal("")),
  default_user_agent: z.string().min(1).optional(),
});

configRouter.get("/", async (c) => {
  const cfg = await loadConfig();
  // never expose password_hash or session secrets through this endpoint
  return c.json({
    admin_username: cfg.admin.username,
    must_change_password: cfg.admin.must_change_password,
    ip_allowlist: cfg.ip_allowlist,
    public_base_url: cfg.public_base_url ?? "",
    default_user_agent: cfg.default_user_agent,
  });
});

configRouter.put("/", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation failed", details: parsed.error.flatten() }, 400);
  }
  const current = await loadConfig();
  const updated = await saveConfig({
    ...current,
    ip_allowlist: parsed.data.ip_allowlist ?? current.ip_allowlist,
    public_base_url:
      parsed.data.public_base_url === ""
        ? undefined
        : (parsed.data.public_base_url ?? current.public_base_url),
    default_user_agent: parsed.data.default_user_agent ?? current.default_user_agent,
  });
  return c.json({
    ip_allowlist: updated.ip_allowlist,
    public_base_url: updated.public_base_url ?? "",
    default_user_agent: updated.default_user_agent,
  });
});
