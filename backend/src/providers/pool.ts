import type { Node } from "../schemas/node.js";
import type { Provider } from "../schemas/provider.js";
import { providerRepo } from "../storage/repos.js";
import { loadProviderNodes } from "./load.js";
import { dedupeNodes } from "../parsers/dedup.js";
import { readProviderCache } from "./cache-store.js";

export interface NodePoolItem {
  node: Node;
  source: "provider";
  provider_id: string;
}

/**
 * Build the global node pool from all enabled providers.
 *
 * 节点加载并发跑,机场数量虽然少但 cache miss 时(刚启动 / cache 文件刚被 watcher
 * invalidate)每个机场要重新过一遍 readJson + zod 校验,串行的话延迟会线性叠加。
 * dedup 不能并发,但只是内存操作,瓶颈不在这。
 *
 * byProvider Map 构建成本很低(只是引用),所有 caller 都能直接拿到;
 * profile-resolver 只用 nodes 字段时也不用付额外代价。
 */
export async function buildNodePool(opts: {
  providerIds?: string[]; // restrict to these provider ids; if undefined, all enabled
  // true = 预览路径:无 cache 的机场不同步拉,后台刷新并把 id 计入 revalidating,先返回空。
  staleWhileRevalidate?: boolean;
} = {}): Promise<{ nodes: Node[]; byProvider: Map<string, Node[]>; revalidating: string[] }> {
  const all = await providerRepo.list();
  const targets = all.filter(
    (entry) =>
      entry.data.enabled && (!opts.providerIds || opts.providerIds.includes(entry.data.id)),
  );

  const loaded = await Promise.all(
    targets.map((entry) =>
      loadProviderNodes(entry.data, { staleWhileRevalidate: opts.staleWhileRevalidate }),
    ),
  );

  const byProvider = new Map<string, Node[]>();
  const collected: Node[] = [];
  const revalidating: string[] = [];
  targets.forEach((entry, i) => {
    const { nodes, revalidating: pending } = loaded[i];
    byProvider.set(entry.data.id, nodes);
    for (const n of nodes) collected.push(n);
    if (pending) revalidating.push(entry.data.id);
  });

  return { nodes: dedupeNodes(collected, { strategy: "keep-first" }), byProvider, revalidating };
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
  // 并发读 cache 文件,N 个机场从 O(N×stat+read) 降到 O(stat+read)。
  const caches = await Promise.all(all.map((entry) => readProviderCache(entry.data.id)));
  return all.map((entry, i) => {
    const cache = caches[i];
    return {
      provider: entry.data,
      cached: cache !== null,
      fetched_at: cache?.fetched_at,
      status: cache?.status,
      node_count: cache?.nodes.length ?? 0,
      error: cache?.error,
    };
  });
}
