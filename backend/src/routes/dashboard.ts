import { Hono } from "hono";
import { listProvidersWithCache, buildNodePool } from "../providers/pool.js";
import { readProviderCache } from "../providers/cache-store.js";
import { providerRepo, profileRepo } from "../storage/repos.js";
import type { Node } from "../schemas/node.js";

export const dashboardRouter = new Hono();

dashboardRouter.get("/airports", async (c) => {
  const summaries = await listProvidersWithCache();
  const items = await Promise.all(
    summaries.map(async (s) => {
      const cache = await readProviderCache(s.provider.id);
      return {
        id: s.provider.id,
        name: s.provider.name,
        type: s.provider.type,
        url: s.provider.url,
        enabled: s.provider.enabled,
        status: s.status ?? "unknown",
        node_count: s.node_count,
        fetched_at: s.fetched_at,
        error: s.error,
        userinfo: cache?.userinfo,
        raw_userinfo_header: cache?.raw_userinfo_header,
      };
    }),
  );
  return c.json({ items });
});

dashboardRouter.get("/summary", async (c) => {
  const [providers, profiles] = await Promise.all([providerRepo.list(), profileRepo.list()]);
  return c.json({
    providers: providers.length,
    profiles: profiles.length,
  });
});

dashboardRouter.get("/node-pool", async (c) => {
  const pool = await buildNodePool({ includeManual: true });
  const byProvider: Record<string, Node[]> = {};
  for (const [provId, nodes] of pool.byProvider) {
    byProvider[provId] = nodes;
  }
  return c.json({
    nodes: pool.nodes,
    count: pool.nodes.length,
    by_provider: byProvider,
  });
});
