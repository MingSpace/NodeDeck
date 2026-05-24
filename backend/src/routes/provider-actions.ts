import { Hono } from "hono";
import { providerRepo } from "../storage/repos.js";
import { refreshProvider, refreshAllProviders } from "../providers/load.js";
import { readProviderCache } from "../providers/cache-store.js";
import { listProvidersWithCache } from "../providers/pool.js";
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
