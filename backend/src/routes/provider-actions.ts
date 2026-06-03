import { Hono } from "hono";
import { z } from "zod";
import { providerRepo } from "../storage/repos.js";
import { refreshProvider, refreshAllProviders } from "../providers/load.js";
import { readProviderCache } from "../providers/cache-store.js";
import { listProvidersWithCache } from "../providers/pool.js";
import { fetchProviderContent, type ProviderFetchInput } from "../providers/fetcher.js";
import { extractHostsFromText } from "../import/extract-hosts.js";
import { logger } from "../logger.js";

export const providerActionsRouter = new Hono();

providerActionsRouter.get("/status", async (c) => {
  const summaries = await listProvidersWithCache();
  return c.json({ items: summaries });
});

providerActionsRouter.get("/:id/nodes", async (c) => {
  const id = c.req.param("id");
  const cache = await readProviderCache(id);
  if (!cache) return c.json({ error: "no cache yet" }, 404);
  return c.json({
    provider_id: id,
    count: cache.nodes.length,
    fetched_at: cache.fetched_at,
    nodes: cache.nodes,
  });
});

providerActionsRouter.post("/:id/refresh", async (c) => {
  const id = c.req.param("id");
  const entry = await providerRepo.get(id);
  if (!entry) return c.json({ error: "provider not found" }, 404);
  logger.info({ providerId: id, source: "manual" }, "Provider refresh requested");
  const cache = await refreshProvider(entry.data, { force: true });
  return c.json({
    provider_id: cache.provider_id,
    status: cache.status,
    fetched_at: cache.fetched_at,
    node_count: cache.nodes.length,
    error: cache.error,
  });
});

const extractHostsBodySchema = z.object({
  type: z.enum(["http", "file", "inline"]),
  url: z.string().url().optional(),
  path: z.string().optional(),
  content: z.string().optional(),
  user_agent: z.string().optional(),
});

// 从订阅(URL / 文件 / inline 内容)抽取上游自带的 hosts 段(Clash 顶层 hosts: / Surge [Host])。
// 接收 provider 草稿子集而非 :id,故新建未保存的源也能用。
providerActionsRouter.post("/extract-hosts", async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = extractHostsBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: "invalid body", issues: parsed.error.issues }, 400);
  }
  const d = parsed.data;
  if (d.type === "http" && !d.url) return c.json({ error: "http 源需要 url" }, 400);
  if (d.type === "file" && !d.path) return c.json({ error: "file 源需要 path" }, 400);
  if (d.type === "inline" && !d.content) return c.json({ error: "inline 源需要 content" }, 400);

  // hosts 段只存在于结构化配置(Clash YAML / Surge conf),base64/uri 列表里没有。
  // 故 http 源在用户未指定 UA 时,优先用 Clash UA 拉,最大化拿到带 hosts: 的 YAML
  // (fetcher 仍会在空 body 时继续回退其它 UA)。
  const ua =
    d.user_agent && d.user_agent.trim().length > 0
      ? d.user_agent
      : d.type === "http"
        ? "clash-verge/v2.0.0"
        : "";
  const input: ProviderFetchInput = {
    id: "__extract_hosts__",
    type: d.type,
    url: d.url,
    path: d.path,
    content: d.content,
    user_agent: ua,
  };

  try {
    const result = await fetchProviderContent(input);
    const extracted = extractHostsFromText(result.text);
    return c.json({
      format: extracted.format,
      count: Object.keys(extracted.hosts).length,
      hosts: extracted.hosts,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, type: d.type }, "extract-hosts fetch failed");
    return c.json({ error: `抓取订阅失败: ${msg}` }, 502);
  }
});

providerActionsRouter.post("/refresh-all", async (c) => {
  logger.info({ source: "manual" }, "Provider refresh-all requested");
  const result = await refreshAllProviders({ force: true });
  logger.info(
    { refreshed: result.refreshed.length, skipped: result.skippedLocked.length },
    "Provider refresh-all done",
  );
  return c.json({
    count: result.refreshed.length,
    skipped_locked: result.skippedLocked,
  });
});
