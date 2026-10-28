import { resolveUserAgents, type Provider } from "../schemas/provider.js";
import type { Node } from "../schemas/node.js";
import { fetchProviderContent } from "./fetcher.js";
import {
  readProviderCache,
  rememberedUserAgent,
  writeProviderCache,
  type ProviderCache,
  type RetryState,
} from "./cache-store.js";
import { parseSubscriptionWithInfo } from "../parsers/index.js";
import { extractInfoNodeQuota } from "../parsers/info-node-extract.js";
import { annotateNodes } from "../parsers/normalize.js";
import { filterInfoNodes } from "../parsers/info-node-filter.js";
import { deriveProviderHostOverrides } from "../import/extract-hosts.js";
import { parseUserInfoHeader } from "../schemas/userinfo.js";
import { providerRepo } from "../storage/repos.js";
import { REFRESH_INTERVAL_MINUTES } from "../schemas/common.js";
import { evaluateProviderQuota } from "./quota.js";
import {
  notifyProviderRefreshFailed,
  notifyProviderZeroNodes,
  onProviderRefreshSucceeded,
} from "../notifications/service.js";
import { logger } from "../logger.js";

export interface RefreshOptions {
  /** if true, ignore cache TTL and fetch immediately. never(手动刷新)模式下 force=true 也会穿透。 */
  force?: boolean;
}

export async function refreshProvider(provider: Provider, opts: RefreshOptions = {}): Promise<ProviderCache> {
  const cached = await readProviderCache(provider.id);
  const interval = provider.refresh.interval;

  if (!opts.force && cached) {
    const minutes = REFRESH_INTERVAL_MINUTES[interval];
    // null = never(手动刷新):non-force 路径(scheduler / loadProviderNodes)一律使用 cache,不自动拉。
    // 关键:不论 cache 是 ok / stale / error 都 short-circuit——否则失败(如 403)的手动源会被
    //   每分钟的 scheduler 反复重拉,既打爆机场又每到冷却期就推一条 Bark 失败通知。
    // 只有「完全无 cache」时才穿透 fetch 做一次种子;用户手动点刷新走 force=true 穿透。
    if (minutes === null) {
      return cached;
    }
    // 周期模式:ok cache 未过期时复用;stale/error 按 retryDelayMinutes 退避,不跟着 scheduler 每分钟重拉。
    if (minutes > 0) {
      if (cached.status === "ok") {
        const ageMin = (Date.now() - cached.fetched_at) / 1000 / 60;
        if (ageMin < effectiveRefreshMinutes(provider, cached, minutes)) {
          return cached;
        }
      } else if (cached.retry) {
        const sinceMin = (Date.now() - cached.retry.last_attempt_at) / 1000 / 60;
        if (sinceMin < retryDelayMinutes(cached.retry.failures, minutes)) {
          return cached;
        }
      }
    }
    // minutes === 0 (on_request) 或已过期 / 到了重试时间穿透到下面 fetch。
  }
  const retry = nextRetryState(cached);
  try {
    const result = await fetchProviderContent(provider, {
      preferUserAgent: rememberedUserAgent(cached?.ua_memory, provider.user_agents),
    });
    const { nodes: rawNodes, infoNodeNames } = parseSubscriptionWithInfo(result.text, provider.parser_hint);
    const info_quota = extractInfoNodeQuota(infoNodeNames, result.fetched_at);
    const nodes = annotateNodes(rawNodes).map((n) => ({ ...n, source_provider_id: provider.id }));
    const userinfo = parseUserInfoHeader(result.userinfo_header) ?? undefined;
    // 只挑「与本源节点 server 域名相关」的 host 覆盖随刷新存入 cache:命中节点域名的上游
    // [Host]/hosts: 条目 + Surge encrypted-dns-server 推导的节点 DoH(deriveProviderHostOverrides);
    // 生成订阅时由 profile-resolver 按 emit_hosts 自动并入,故"每次更新自动解析"。
    const extractedMap = deriveProviderHostOverrides({
      text: result.text,
      nodeServerDomains: nodes.map((n) => n.server),
    });
    const extracted_hosts = Object.keys(extractedMap).length > 0 ? extractedMap : undefined;
    // 解析出 0 节点 ≠ "ok"——这是用户最容易踩的坑(尤其 inline 类型 content 为空 / 格式错配)。
    // 直接写 error 状态 + 具体原因,让前端能给出有用反馈,而不是绿色徽标"0 个节点"装作成功。
    if (nodes.length === 0) {
      const emptyReason =
        provider.type === "inline"
          ? "请在编辑器中填写节点文本"
          : provider.type === "file"
            ? "文件为空"
            : "User-Agent 列表里的每个 UA 上游都返回空 body;该订阅可能已失效,或需要特定 UA——可在节点源的 User-Agent 列表里添加";
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
        extracted_hosts,
        info_quota,
        retry,
      };
      // 远程订阅拿到 200 却解析不出节点(限流提示页、「请使用客户端」页等),多半是上游临时状况:
      // 和拉取报错一样回退上次的节点,别让一次坏响应把订阅里这个机场整个清空。
      // 离线源(inline / file)0 节点是内容本身的问题,照旧报 error。
      const fallback = provider.type === "http" && withNodes(cached);
      const written: ProviderCache = fallback ? { ...fallback, status: "stale", error: reason, retry } : cache;
      await writeProviderCache(written);
      logger.warn({ providerId: provider.id, reason, keptPreviousNodes: Boolean(fallback) }, "Provider parsed 0 nodes");
      // 通知是旁路:fire-and-forget,service 内部自行处理开关/冷却/异常
      void notifyProviderZeroNodes(provider, reason);
      return written;
    }
    const cache: ProviderCache = {
      provider_id: provider.id,
      fetched_at: result.fetched_at,
      status: "ok",
      raw_userinfo_header: result.userinfo_header ?? undefined,
      userinfo,
      nodes,
      extracted_hosts,
      info_quota,
      ua_memory:
        result.used_user_agent === undefined
          ? undefined
          : { user_agent: result.used_user_agent, list: resolveUserAgents(provider.user_agents) },
    };
    await writeProviderCache(cache);
    logger.info(
      { providerId: provider.id, nodeCount: nodes.length, extractedHostCount: Object.keys(extracted_hosts ?? {}).length },
      "Provider refreshed",
    );
    // 成功后清失败冷却状态 + 检查剩余流量/到期时间(旁路,绝不影响刷新结果)
    void onProviderRefreshSucceeded(provider, userinfo);
    return cache;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    void notifyProviderRefreshFailed(provider, errorMsg);
    const fallback = withNodes(cached);
    if (fallback) {
      const stale: ProviderCache = { ...fallback, status: "stale", error: errorMsg, retry };
      await writeProviderCache(stale);
      return stale;
    }
    const fail: ProviderCache = {
      ...(cached ?? {}),
      provider_id: provider.id,
      fetched_at: Date.now(),
      status: "error",
      error: errorMsg,
      nodes: [],
      retry,
    };
    await writeProviderCache(fail);
    return fail;
  }
}

/** 有节点可回退的旧 cache;0 节点的 error cache 不算,回退过去只会显示「使用旧缓存」却一个节点都没有 */
function withNodes(cached: ProviderCache | null): ProviderCache | null {
  return cached && cached.nodes.length > 0 ? cached : null;
}

// 刷新失败后的自动重试:先快速重试几次(5 → 10 → 20 分钟),仍失败就「转离线」——沿用上次拉到的节点,
// 之后只按节点源自己的刷新周期偶尔再试。
// - 一次刷新会按「线路 × UA」发出十几个请求,机场正在限流 / 拦截时每分钟重拉只会越拉越久
// - 有些机场的订阅链接只有几十分钟有效期,过期后再怎么重拉也拿不到,沿用最后一份节点才是对的
// 用户手动刷新(force)不受限;刷新成功写 ok cache 即清零。
const RETRY_BASE_MINUTES = 5;
export const OFFLINE_AFTER_FAILURES = 4;

/** 连续失败 failures 次后,距上次尝试多久再自动试;转离线后回到节点源自己的周期 */
export function retryDelayMinutes(failures: number, intervalMinutes: number): number {
  if (failures >= OFFLINE_AFTER_FAILURES) return intervalMinutes;
  return Math.min(RETRY_BASE_MINUTES * 2 ** Math.max(0, failures - 1), intervalMinutes);
}

/** 这一次若失败要写进 cache 的重试状态:接着上次的连续失败次数加一,上次成功则从 1 开始 */
function nextRetryState(cached: ProviderCache | null): RetryState {
  const previous = cached && cached.status !== "ok" ? (cached.retry?.failures ?? 0) : 0;
  return { failures: previous + 1, last_attempt_at: Date.now() };
}

// 按上游数据(userinfo 或信息节点)判定用完 / 到期而被排除的在线源,周期缩到 1 小时:
// 机场重置或续费后尽快恢复,不必干等一个 24h 周期。手动标记 / 手填到期靠日期恢复,与重拉无关,不缩短;
// 离线源重拉也只是重新解析同一份文本,同样不缩短。
const QUOTA_RECHECK_MINUTES = 60;

function effectiveRefreshMinutes(provider: Provider, cached: ProviderCache, minutes: number): number {
  if (provider.type === "inline" || minutes <= QUOTA_RECHECK_MINUTES) return minutes;
  const quota = evaluateProviderQuota(provider, cached);
  const upstreamBlocked =
    quota.excluded &&
    (quota.reason === "traffic_exhausted" || (quota.reason === "expired" && quota.expire_source !== "manual"));
  return upstreamBlocked ? QUOTA_RECHECK_MINUTES : minutes;
}

/**
 * 后台刷新去重(singleflight)。SWR 预览路径在 cache miss 时 fire-and-forget 调用,
 * 同一 provider 的并发预览请求(preview + node-pool-preview + 前端轮询)只触发一次真实 fetch,
 * 避免冷启动瞬间把同一机场拉爆 / 浪费机场配额。
 */
const backgroundRevalidations = new Map<string, Promise<ProviderCache>>();

export function revalidateProviderInBackground(provider: Provider): Promise<ProviderCache> {
  const existing = backgroundRevalidations.get(provider.id);
  if (existing) return existing;
  // force=true:预览只在"无可用 cache"时才走到这里,直接穿透去机场拉种子。
  const task = refreshProvider(provider, { force: true });
  backgroundRevalidations.set(provider.id, task);
  // 附加 catch 防 unhandledRejection(refreshProvider 内部通常已 swallow,这里兜底)。
  task
    .catch((err) => logger.warn({ err, providerId: provider.id }, "Background revalidation failed"))
    .finally(() => backgroundRevalidations.delete(provider.id));
  return task;
}

export interface LoadedProviderNodes {
  nodes: Node[];
  /**
   * true = 该 provider 当前没有可用 cache,已在后台触发刷新,结果稍后可用。
   * 仅 SWR 预览路径会出现;真实下发(/sub)路径同步等到结果,恒为 false。
   */
  revalidating: boolean;
}

export async function loadProviderNodes(
  provider: Provider,
  opts: { staleWhileRevalidate?: boolean } = {},
): Promise<LoadedProviderNodes> {
  // 预览路径(SWR):绝不同步等机场网络。有 cache(含 stale)立即用;无 cache 则后台拉一次(去重)、
  // 先返回空,让首屏永远不卡在网络拉取上(冷启动体验的关键)。
  if (opts.staleWhileRevalidate) {
    const cache = await readProviderCache(provider.id);
    if (cache?.nodes && cache.nodes.length > 0) {
      return { nodes: filterInfoNodes(cache.nodes), revalidating: false };
    }
    void revalidateProviderInBackground(provider);
    return { nodes: [], revalidating: true };
  }

  // 真实下发路径(/sub):保持原行为,cache miss 时同步拉,保证客户端永远拿到完整节点。
  // on_request: /sub 请求路径每次都同步去机场拉一次(失败回退 stale cache 由 refreshProvider 处理)。
  if (provider.refresh.interval === "on_request") {
    const refreshed = await refreshProvider(provider);
    return { nodes: filterInfoNodes(refreshed.nodes), revalidating: false };
  }
  const cache = await readProviderCache(provider.id);
  // 保底:旧 cache 可能是过滤规则上线前写入的,里面还残留 Traffic/Expire 信息节点。
  // 这里再过滤一次,保证下游消费(策略组、profile、订阅生成)永远拿到干净集合。
  if (cache?.nodes && cache.nodes.length > 0) {
    return { nodes: filterInfoNodes(cache.nodes), revalidating: false };
  }
  const refreshed = await refreshProvider(provider);
  return { nodes: filterInfoNodes(refreshed.nodes), revalidating: false };
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
