import type { Node } from "../schemas/node.js";
import type { Provider } from "../schemas/provider.js";
import { providerRepo } from "../storage/repos.js";
import { readManualNodes } from "../storage/manual-nodes.js";
import { loadProviderNodes } from "./load.js";
import { dedupeNodes } from "../parsers/dedup.js";
import { annotateNodes } from "../parsers/normalize.js";

export interface NodePoolItem {
  node: Node;
  source: "manual" | "provider";
  provider_id?: string;
}

/**
 * Build the global node pool from all enabled providers + manual nodes.
 */
export async function buildNodePool(opts: {
  providerIds?: string[]; // restrict to these provider ids; if undefined, all enabled
  includeManual?: boolean;
} = {}): Promise<{ nodes: Node[]; byProvider: Map<string, Node[]> }> {
  const includeManual = opts.includeManual ?? true;
  const all = await providerRepo.list();
  const byProvider = new Map<string, Node[]>();
  const collected: Node[] = [];

  for (const entry of all) {
    if (!entry.data.enabled) continue;
    if (opts.providerIds && !opts.providerIds.includes(entry.data.id)) continue;
    const nodes = await loadProviderNodes(entry.data);
    byProvider.set(entry.data.id, nodes);
    collected.push(...nodes);
  }

  if (includeManual) {
    const manual = await readManualNodes();
    if (manual.nodes.length > 0) {
      const tagged = annotateNodes(
        manual.nodes.map((n) => ({ ...n, source_provider_id: n.source_provider_id ?? "manual" })),
      );
      byProvider.set("manual", tagged);
      collected.push(...tagged);
    }
  }

  return { nodes: dedupeNodes(collected, { strategy: "keep-first" }), byProvider };
}

export interface ProviderSummary {
  provider: Provider;
  cached: boolean;
  fetched_at?: number;
  status?: "ok" | "stale" | "error";
  node_count: number;
  error?: string;
}

export async function listProvidersWithCache(): Promise<ProviderSummary[]> {
  const all = await providerRepo.list();
  const out: ProviderSummary[] = [];
  for (const entry of all) {
    const { readProviderCache } = await import("./cache-store.js");
    const cache = await readProviderCache(entry.data.id);
    out.push({
      provider: entry.data,
      cached: cache !== null,
      fetched_at: cache?.fetched_at,
      status: cache?.status,
      node_count: cache?.nodes.length ?? 0,
      error: cache?.error,
    });
  }
  return out;
}
