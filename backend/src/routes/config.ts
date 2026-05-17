import { Hono } from "hono";
import { z } from "zod";
import { loadConfig, saveConfig } from "../storage/config-store.js";
import { resetData } from "../storage/reset.js";
import { logger } from "../logger.js";

export const configRouter = new Hono();

const updateSchema = z.object({
  ip_allowlist: z.array(z.string()).optional(),
  public_base_url: z.string().url().optional().or(z.literal("")),
  default_user_agent: z.string().min(1).optional(),
});

// 必须打这个口令才执行,防止误触发(类似 GitHub 删仓库的 confirmation)
const RESET_CONFIRMATION = "RESET";

const resetSchema = z.object({
  confirmation: z.literal(RESET_CONFIRMATION),
  scope: z
    .object({
      providers: z.boolean().optional(),
      rules: z.boolean().optional(),
      groups: z.boolean().optional(),
      modules: z.boolean().optional(),
      general: z.boolean().optional(),
      profiles: z.boolean().optional(),
      cache: z.boolean().optional(),
      service_settings: z.boolean().optional(),
    })
    .refine((s) => Object.values(s).some((v) => v === true), {
      message: "至少需要选择一项要还原的内容",
    }),
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

/**
 * 还原数据配置:按 scope 批量删除 data/ 下的实体 yaml + cache。
 *
 * @business_rule 管理员账号永远不会被影响,服务设置(IP 白名单/PUBLIC_BASE_URL/UA)
 * 只有显式勾选 service_settings 才会被重置成默认值。
 * @business_rule 必须传 `confirmation: "RESET"` 才会执行,防止误调用。
 */
configRouter.post("/reset", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = resetSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation failed", details: parsed.error.flatten() }, 400);
  }
  const result = await resetData(parsed.data.scope);
  logger.warn({ scope: parsed.data.scope, removed: result.removed }, "Data reset performed");
  return c.json({ ok: true, ...result });
});
