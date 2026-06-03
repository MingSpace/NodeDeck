import type { Provider } from "../schemas/provider.js";
import type { Node } from "../schemas/node.js";
import { fetchProviderContent } from "./fetcher.js";
import { readProviderCache, writeProviderCache, type ProviderCache } from "./cache-store.js";
import { parseSubscription } from "../parsers/index.js";
import { annotateNodes } from "../parsers/normalize.js";
import { filterInfoNodes } from "../parsers/info-node-filter.js";
import { parseUserInfoHeader } from "../schemas/userinfo.js";
import { providerRepo } from "../storage/repos.js";
import { REFRESH_INTERVAL_MINUTES } from "../schemas/common.js";
import { logger } from "../logger.js";

export interface RefreshOptions {
  /** if true, ignore cache TTL and fetch immediately. never(手动刷新)模式下 force=true 也会穿透。 */
  force?: boolean;
}

export async function refreshProvider(provider: Provider, opts: RefreshOptions = {}): Promise<ProviderCache> {
  const cached = await readProviderCache(provider.id);
  const interval = provider.refresh.interval;

  if (!opts.force && cached?.status === "ok") {
    const minutes = REFRESH_INTERVAL_MINUTES[interval];
    // null = never(手动刷新):non-force 路径(scheduler / loadProviderNodes)一律使用 cache,不自动拉。
    // 用户手动点刷新按钮时走 force=true 路径,会绕过这里穿透到 fetch。
    if (minutes === null) {
      if (cached.nodes.length > 0) return cached;
    } else if (minutes > 0) {
      const ageMin = (Date.now() - cached.fetched_at) / 1000 / 60;
      if (ageMin < minutes) {
        return cached;
      }
    }
    // minutes === 0 (on_request) 穿透到下面 fetch。
  }
  try {
    const result = await fetchProviderContent(provider);
    const rawNodes = parseSubscription(result.text, provider.parser_hint);
    const nodes = annotateNodes(rawNodes).map((n) => ({ ...n, source_provider_id: provider.id }));
    const userinfo = parseUserInfoHeader(result.userinfo_header) ?? undefined;
    // 解析出 0 节点 ≠ "ok"——这是用户最容易踩的坑(尤其 inline 类型 content 为空 / 格式错配)。
    // 直接写 error 状态 + 具体原因,让前端能给出有用反馈,而不是绿色徽标"0 个节点"装作成功。
    if (nodes.length === 0) {
      const emptyReason =
        provider.type === "inline"
          ? "请在编辑器中填写节点文本"
          : provider.type === "file"
            ? "文件为空"
            : "已尝试多个 User-Agent 上游仍返回空 body;该订阅可能已失效,或需要特定 UA——可在节点源里手动指定 User-Agent";
      const reason =
        result.text.trim().length === 0
          ? `content 为空(${emptyReason})`
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
    return filterInfoNodes(refreshed.nodes);
  }
  const cache = await readProviderCache(provider.id);
  // 保底:旧 cache 可能是过滤规则上线前写入的,里面还残留 Traffic/Expire 信息节点。
  // 这里再过滤一次,保证下游消费(策略组、profile、订阅生成)永远拿到干净集合。
  if (cache?.nodes && cache.nodes.length > 0) return filterInfoNodes(cache.nodes);
  const refreshed = await refreshProvider(provider);
  return filterInfoNodes(refreshed.nodes);
}

export interface RefreshAllResult {
  refreshed: ProviderCache[];
  /**
   * Provider IDs that were skipped because interval=never (手动刷新)且当前调用 non-force。
   * force=true 时一定为空数组(用户手动触发"刷新全部"会一起拉)。
   */
  skippedLocked: string[];
}

export async function refreshAllProviders(opts: RefreshOptions = {}): Promise<RefreshAllResult> {
  const all = await providerRepo.list();
  const enabled = all.filter((e) => e.data.enabled);

  // non-force 路径下,never(手动刷新)+ ok cache 不参与拉取。
  // force=true(用户点"刷新全部")则一视同仁,全部送进 refreshProvider。
  let toRefresh = enabled;
  let skippedLocked: string[] = [];
  if (!opts.force) {
    const lockedFlags = await Promise.all(
      enabled.map(async (entry) => {
        if (entry.data.refresh.interval !== "never") return false;
        const existing = await readProviderCache(entry.id);
        return Boolean(existing?.status === "ok" && existing.nodes.length > 0);
      }),
    );
    skippedLocked = enabled.filter((_, i) => lockedFlags[i]).map((e) => e.id);
    toRefresh = enabled.filter((_, i) => !lockedFlags[i]);
  }

  // 真正拉取并发跑,单机场失败不影响其它(refreshProvider 内部已经把 fetch 异常落到 stale cache)。
  const results = await Promise.allSettled(toRefresh.map((entry) => refreshProvider(entry.data, opts)));
  const refreshed: ProviderCache[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") refreshed.push(r.value);
    else logger.warn({ err: r.reason, providerId: toRefresh[i].id }, "Refresh failed (unexpected)");
  });
  return { refreshed, skippedLocked };
}
