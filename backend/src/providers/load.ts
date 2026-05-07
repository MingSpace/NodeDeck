import type { Provider } from "../schemas/provider.js";
import type { Node } from "../schemas/node.js";
import { fetchProviderContent } from "./fetcher.js";
import { readProviderCache, writeProviderCache, type ProviderCache } from "./cache-store.js";
import { parseSubscription } from "../parsers/index.js";
import { annotateNodes } from "../parsers/normalize.js";
import { parseUserInfoHeader } from "../schemas/userinfo.js";
import { providerRepo } from "../storage/repos.js";
import { REFRESH_INTERVAL_MINUTES } from "../schemas/common.js";
import { logger } from "../logger.js";

export interface RefreshOptions {
  /** if true, ignore cache TTL and fetch immediately. never 模式下仍然短路。 */
  force?: boolean;
}

export async function refreshProvider(provider: Provider, opts: RefreshOptions = {}): Promise<ProviderCache> {
  const cached = await readProviderCache(provider.id);
  const interval = provider.refresh.interval;

  // never:已有 ok cache 就锁死,即使 force 也忽略。无 cache 时仍然落到下面拉一次种子。
  if (interval === "never" && cached?.status === "ok" && cached.nodes.length > 0) {
    return cached;
  }

  if (!opts.force && cached?.status === "ok") {
    const minutes = REFRESH_INTERVAL_MINUTES[interval];
    // null = never(走到这里说明 cache 不 ok,需要拉种子);0 = on_request,总是穿透到 fetch。
    if (minutes !== null && minutes > 0) {
      const ageMin = (Date.now() - cached.fetched_at) / 1000 / 60;
      if (ageMin < minutes) {
        return cached;
      }
    }
  }
  try {
    const result = await fetchProviderContent(provider);
    const rawNodes = parseSubscription(result.text, provider.parser_hint);
    const nodes = annotateNodes(rawNodes).map((n) => ({ ...n, source_provider_id: provider.id }));
    const userinfo = parseUserInfoHeader(result.userinfo_header) ?? undefined;
    // 解析出 0 节点 ≠ "ok"——这是用户最容易踩的坑(尤其 inline 类型 content 为空 / 格式错配)。
    // 直接写 error 状态 + 具体原因,让前端能给出有用反馈,而不是绿色徽标"0 个节点"装作成功。
    if (nodes.length === 0) {
      const reason =
        result.text.trim().length === 0
          ? `content 为空(${provider.type === "inline" ? "请在编辑器中填写节点文本" : "上游返回了空响应"})`
          : `未识别到任何节点(parser_hint=${provider.parser_hint})。支持: Clash YAML(含 proxies: 数组) / Surge .conf / 节点 URI 列表 / v2ray base64;direct 节点会被跳过。可尝试手动指定 parser_hint`;
      const cache: ProviderCache = {
        provider_id: provider.id,
        fetched_at: result.fetched_at,
        status: "error",
        error: reason,
        raw_userinfo_header: result.userinfo_header ?? undefined,
        userinfo,
        nodes: [],
      };
      await writeProviderCache(cache);
      logger.warn({ providerId: provider.id, reason }, "Provider parsed 0 nodes");
      return cache;
    }
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
  // on_request: /sub 请求路径每次都同步去机场拉一次(失败回退 stale cache 由 refreshProvider 处理)。
  if (provider.refresh.interval === "on_request") {
    const refreshed = await refreshProvider(provider);
    return refreshed.nodes;
  }
  const cache = await readProviderCache(provider.id);
  if (cache?.nodes && cache.nodes.length > 0) return cache.nodes;
  const refreshed = await refreshProvider(provider);
  return refreshed.nodes;
}

export interface RefreshAllResult {
  refreshed: ProviderCache[];
  /** Provider IDs that were skipped because interval=never and ok cache exists (force 也无效)。 */
  skippedLocked: string[];
}

export async function refreshAllProviders(opts: RefreshOptions = {}): Promise<RefreshAllResult> {
  const all = await providerRepo.list();
  const refreshed: ProviderCache[] = [];
  const skippedLocked: string[] = [];
  for (const entry of all) {
    if (!entry.data.enabled) continue;
    if (entry.data.refresh.interval === "never") {
      const existing = await readProviderCache(entry.id);
      if (existing?.status === "ok" && existing.nodes.length > 0) {
        skippedLocked.push(entry.id);
        continue;
      }
    }
    refreshed.push(await refreshProvider(entry.data, opts));
  }
  return { refreshed, skippedLocked };
}
