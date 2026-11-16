import { Hono } from "hono";
import { z } from "zod";
import { surgeModuleRepo } from "../storage/repos.js";
import { fetchViaSchema } from "../schemas/provider.js";
import { fetchTextViaRoutes } from "../providers/fetcher.js";
import { loadRemoteModule, readModuleCache, type ModuleCache } from "../surge-modules/remote.js";
import { checkModuleText, parseSgmodule } from "../surge-modules/sgmodule.js";
import { moduleLinks, publicBaseUrl } from "../surge-modules/links.js";
import { logger } from "../logger.js";

export const moduleActionsRouter = new Hono();

// 与 frontend/src/pages/modules/api.ts ModuleStatus 保持同步
function cacheSummary(cache: ModuleCache | null, url: string | undefined) {
  // URL 改过后旧缓存作废,与 loadRemoteModule 的判断一致
  if (!cache || cache.url !== (url?.trim() ?? "")) return undefined;
  const parsed = cache.text !== undefined ? parseSgmodule(cache.text) : undefined;
  return {
    status: cache.status,
    fetched_at: cache.fetched_at,
    ok_at: cache.ok_at,
    error: cache.error,
    bytes: cache.text?.length,
    name: parsed?.meta.name,
    desc: parsed?.meta.desc,
    sections: parsed?.sections.map((s) => s.name),
  };
}

// 每个模块的公开安装地址 + 远程模块的缓存状态(只读,不触发拉取)
moduleActionsRouter.get("/status", async (c) => {
  const baseUrl = await publicBaseUrl(c);
  const entries = await surgeModuleRepo.list();
  const items = await Promise.all(
    entries.map(async ({ data: m }) => ({
      id: m.id,
      source: m.source,
      public: m.public,
      ...moduleLinks(baseUrl, m.id, m.public),
      remote: m.source === "remote" ? (cacheSummary(await readModuleCache(m.id), m.url) ?? null) : undefined,
    })),
  );
  return c.json({ items });
});

moduleActionsRouter.post("/:id/refresh", async (c) => {
  const id = c.req.param("id");
  const entry = await surgeModuleRepo.get(id);
  if (!entry) return c.json({ error: "module not found" }, 404);
  if (entry.data.source !== "remote") return c.json({ error: "本地模块无需刷新" }, 400);
  logger.info({ moduleId: id, source: "manual" }, "Remote module refresh requested");
  const cache = await loadRemoteModule(entry.data, { force: true });
  return c.json({ id, remote: cacheSummary(cache, entry.data.url) ?? null });
});

const testFetchSchema = z.object({
  url: z.string().url(),
  fetch_via: fetchViaSchema,
});

// 编辑弹窗里「拉取预览」:按给定 URL / 线路试拉一次,不写缓存
moduleActionsRouter.post("/test-fetch", async (c) => {
  const parsed = testFetchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: "validation failed", details: parsed.error.flatten() }, 400);
  const started = Date.now();
  try {
    const res = await fetchTextViaRoutes(parsed.data.url, parsed.data.fetch_via, {
      userAgent: "Surge NodeDeck",
      timeoutMs: 15_000,
      check: checkModuleText,
      logContext: { source: "module-test-fetch" },
    });
    const mod = parseSgmodule(res.text);
    return c.json({
      ok: true,
      duration_ms: Date.now() - started,
      bytes: res.text.length,
      name: mod.meta.name,
      desc: mod.meta.desc,
      arguments: mod.meta.arguments,
      sections: mod.sections.map((s) => ({ name: s.name, lines: s.lines.length })),
      text: res.text.length > 200_000 ? `${res.text.slice(0, 200_000)}\n…(已截断)` : res.text,
    });
  } catch (err) {
    return c.json({ ok: false, duration_ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) });
  }
});
