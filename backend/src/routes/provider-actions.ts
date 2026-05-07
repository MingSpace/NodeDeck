import { Hono } from "hono";
import { providerRepo } from "../storage/repos.js";
import { refreshProvider, refreshAllProviders } from "../providers/load.js";
import { readProviderCache } from "../providers/cache-store.js";
import { listProvidersWithCache } from "../providers/pool.js";

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
    nodes: cache.nodes.map((n) => ({
      name: n.name,
      type: n.type,
      server: n.server,
      port: n.port,
      region: n.region,
      level: n.level,
      line: n.line,
      tags: n.tags,
    })),
  });
});

providerActionsRouter.post("/:id/refresh", async (c) => {
  const id = c.req.param("id");
  const entry = await providerRepo.get(id);
  if (!entry) return c.json({ error: "provider not found" }, 404);
  if (entry.data.refresh.interval === "never") {
    const existing = await readProviderCache(id);
    if (existing?.status === "ok" && existing.nodes.length > 0) {
      return c.json(
        { error: "provider locked (interval=never)", locked: true },
        403,
      );
    }
  }
  const cache = await refreshProvider(entry.data, { force: true });
  return c.json({
    provider_id: cache.provider_id,
    status: cache.status,
    fetched_at: cache.fetched_at,
    node_count: cache.nodes.length,
    error: cache.error,
  });
});

providerActionsRouter.post("/refresh-all", async (c) => {
  const result = await refreshAllProviders({ force: true });
  return c.json({
    count: result.refreshed.length,
    skipped_locked: result.skippedLocked,
  });
});
