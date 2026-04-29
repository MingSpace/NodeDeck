import type { Provider } from "../schemas/provider.js";
import type { Node } from "../schemas/node.js";
import { fetchProviderContent } from "./fetcher.js";
import { readProviderCache, writeProviderCache, type ProviderCache } from "./cache-store.js";
import { parseSubscription } from "../parsers/index.js";
import { annotateNodes } from "../parsers/normalize.js";
import { parseUserInfoHeader } from "../schemas/userinfo.js";
import { providerRepo } from "../storage/repos.js";
import { logger } from "../logger.js";

export interface RefreshOptions {
  /** if true, ignore cache TTL and fetch immediately */
  force?: boolean;
}

export async function refreshProvider(provider: Provider, opts: RefreshOptions = {}): Promise<ProviderCache> {
  const cached = await readProviderCache(provider.id);
  if (!opts.force && cached?.status === "ok") {
    const ageMin = (Date.now() - cached.fetched_at) / 1000 / 60;
    if (ageMin < provider.refresh.interval_minutes) {
      return cached;
    }
  }
  try {
    const result = await fetchProviderContent(provider);
    const rawNodes = parseSubscription(result.text, provider.parser_hint);
    const nodes = annotateNodes(rawNodes).map((n) => ({ ...n, source_provider_id: provider.id }));
    const userinfo = parseUserInfoHeader(result.userinfo_header) ?? undefined;
    const cache: ProviderCache = {
      provider_id: provider.id,
      fetched_at: result.fetched_at,
      status: "ok",
      raw_userinfo_header: result.userinfo_header ?? undefined,
      userinfo,
      nodes,
    };
    await writeProviderCache(cache);
    logger.info({ providerId: provider.id, nodeCount: nodes.length }, "Provider refreshed");
    return cache;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    if (cached) {
      const stale: ProviderCache = { ...cached, status: "stale", error: errorMsg };
      await writeProviderCache(stale);
      return stale;
    }
    const fail: ProviderCache = {
      provider_id: provider.id,
      fetched_at: Date.now(),
      status: "error",
      error: errorMsg,
      nodes: [],
    };
    await writeProviderCache(fail);
    return fail;
  }
}

export async function loadProviderNodes(provider: Provider): Promise<Node[]> {
  const cache = await readProviderCache(provider.id);
  if (cache?.nodes && cache.nodes.length > 0) return cache.nodes;
  const refreshed = await refreshProvider(provider);
  return refreshed.nodes;
}

export async function refreshAllProviders(opts: RefreshOptions = {}): Promise<ProviderCache[]> {
  const all = await providerRepo.list();
  const out: ProviderCache[] = [];
  for (const entry of all) {
    if (!entry.data.enabled) continue;
    out.push(await refreshProvider(entry.data, opts));
  }
  return out;
}
