import { readFile } from "node:fs/promises";
import { resolveUserAgents, type Provider } from "../schemas/provider.js";
import { parseSubscriptionWithInfo } from "../parsers/index.js";
import { DIRECT_ROUTE, resolveFetchRoutes, type Egress } from "../schemas/egress.js";
import { egressRepo } from "../storage/repos.js";
import { logger } from "../logger.js";
import { describeFetchError } from "./fetch-proxy.js";
import { openEgressFetch } from "./egress.js";

export interface FetchResult {
  text: string;
  userinfo_header: string | null;
  fetched_at: number;
  /** 最终拿到内容(或最后一次 200 空响应)所用的 User-Agent;inline/file 为 undefined。 */
  used_user_agent?: string;
}

/** fetchProviderContent 只用到这几个字段;用 Pick 避免调用方必须造一个完整 Provider。 */
export type ProviderFetchInput = Pick<
  Provider,
  "id" | "type" | "url" | "path" | "content"
> &
  Partial<Pick<Provider, "fetch_via" | "user_agents" | "parser_hint">>;

export interface FetchOptions {
  /** 单次请求超时;Web UI「测试拉取」用更短的值,免得页面干等。 */
  timeoutMs?: number;
  /** 按 id 取出口;默认读 data/egresses,测试里注入。 */
  loadEgress?: (id: string) => Promise<Egress | null>;
  /** 只走这一条线路,不按 fetch_via 换线、也不兜底直连;Web UI「测试拉取」逐条测时用。 */
  route?: string;
  /** 上次拿到节点的 UA(须在 user_agents 里),提到最前先试;失败照常按列表顺序往下 */
  preferUserAgent?: string;
}

const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 10 * 1024 * 1024;

interface FetchOnceResult {
  text: string;
  userinfo_header: string | null;
  status: number;
  ok: boolean;
}

/** 单次 HTTP GET(独立 timeout)。非 2xx 不抛错,以 ok=false 返回,交给上层决定是否换 UA。 */
async function fetchOnce(
  fetchImpl: typeof globalThis.fetch,
  url: string,
  userAgent: string,
  timeoutMs: number,
): Promise<FetchOnceResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: {
        // 空 UA 也显式发送空串:让"留空"成为一个真实的候选(部分机场对空 UA 有专门分支)。
        "user-agent": userAgent,
        accept: "*/*",
      },
      signal: controller.signal,
    });
    const userinfoHeader = res.headers.get("subscription-userinfo");
    if (!res.ok) {
      return { text: "", userinfo_header: userinfoHeader, status: res.status, ok: false };
    }
    const reader = res.body?.getReader();
    if (!reader) {
      const text = await res.text();
      return { text, userinfo_header: userinfoHeader, status: res.status, ok: true };
    }
    const chunks: Uint8Array[] = [];
    let bytesRead = 0;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        bytesRead += value.byteLength;
        if (bytesRead > MAX_BYTES) {
          throw new Error(`Subscription exceeds size limit (${MAX_BYTES} bytes)`);
        }
        chunks.push(value);
      }
    }
    const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    const buf = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      buf.set(c, offset);
      offset += c.byteLength;
    }
    const text = new TextDecoder().decode(buf);
    return { text, userinfo_header: userinfoHeader, status: res.status, ok: true };
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchProviderContent(
  provider: ProviderFetchInput,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  if (provider.type === "inline") {
    return {
      text: provider.content ?? "",
      userinfo_header: null,
      fetched_at: Date.now(),
    };
  }
  if (provider.type === "file") {
    const text = await readFile(provider.path!, "utf8");
    return {
      text,
      userinfo_header: null,
      fetched_at: Date.now(),
    };
  }
  // type === "http"
  return fetchHttpViaRoutes(provider, opts);
}

const defaultLoadEgress = async (id: string) => (await egressRepo.get(id))?.data ?? null;

/**
 * 按 fetch_via 的顺序逐条线路拉取(直连固定兜底,见 resolveFetchRoutes),拿到能解析出节点的内容即返回;
 * 一条线路失败(连不上 / 全部 UA 非 2xx / 全部空 body 或解析不出节点)才换下一条。全失败时把每条线路
 * 的原因拼在一起报,便于一眼看出卡在哪。
 */
async function fetchHttpViaRoutes(provider: ProviderFetchInput, opts: FetchOptions): Promise<FetchResult> {
  const routes = opts.route ? [opts.route] : resolveFetchRoutes(provider.fetch_via);
  const loadEgress = opts.loadEgress ?? defaultLoadEgress;
  const failures: string[] = [];
  // 都没拿到可用内容时的回传优先级:有内容但解析不出节点 > 200 空 body(load.ts 据此给不同提示)
  let unusableResult: FetchResult | null = null;
  let emptyResult: FetchResult | null = null;

  for (const route of routes) {
    let label = route === DIRECT_ROUTE ? "直连" : `出口 ${route}`;
    try {
      let attempt: HttpAttempt;
      if (route === DIRECT_ROUTE) {
        attempt = await fetchHttp(provider, globalThis.fetch, opts);
      } else {
        const egress = await loadEgress(route);
        if (!egress) throw new Error("不存在(可能已删除)");
        label = `经 ${egress.name}`;
        const routed = openEgressFetch(egress);
        try {
          attempt = await fetchHttp(provider, routed.fetch, opts, egress.name);
        } finally {
          // close 等在途请求结束;这里请求都已完成或已 abort,不会卡住
          await routed.close().catch(() => undefined);
        }
      }
      if (attempt.usable) return attempt.result;
      if (attempt.result.text.trim()) {
        unusableResult ??= attempt.result;
        failures.push(`${label}: 拿到了内容,但没解析出节点`);
      } else {
        emptyResult ??= attempt.result;
        failures.push(`${label}: 上游返回空内容`);
      }
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (routes.length > 1) {
      logger.warn({ providerId: provider.id, route, reason: failures.at(-1) }, "Provider fetch route failed, trying next");
    }
  }

  const fallback = unusableResult ?? emptyResult;
  if (fallback) return fallback;
  // 只有一条线路时原样报错,不加「直连:」前缀,与之前的报错一致
  if (routes.length === 1) throw new Error(failures[0].replace(/^直连: /, ""));
  throw new Error(failures.join(";"));
}

interface HttpAttempt {
  result: FetchResult;
  /** 内容能按 parser_hint 解析出至少一个节点 */
  usable: boolean;
}

/**
 * 按 user_agents 的顺序逐个 UA 请求,拿到能解析出节点的内容就停。机场按 UA 网关时,不认识的 UA
 * 常拿到 200 空 body,或一张「请使用客户端」的 HTML,两种都换下一个 UA。
 */
async function fetchHttp(
  provider: ProviderFetchInput,
  fetchImpl: typeof globalThis.fetch,
  opts: FetchOptions,
  egressName?: string,
): Promise<HttpAttempt> {
  const url = provider.url!;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  // 订阅 token 多在 query / path 里,日志会落盘并推到 Web UI,只记 host
  const logUrl = redactSubscriptionUrl(url);
  const list = resolveUserAgents(provider.user_agents);
  const prefer = opts.preferUserAgent;
  const candidates = prefer !== undefined && list.includes(prefer) ? [prefer, ...list.filter((ua) => ua !== prefer)] : list;
  const parsesToNodes = (text: string) =>
    parseSubscriptionWithInfo(text, provider.parser_hint ?? "auto").nodes.length > 0;

  // 都不可用时回传最靠前的「有内容但解析不出」,其次最后一次 200 空 body,交给 load.ts 报具体原因
  let firstUnusable: FetchResult | null = null;
  let lastOkEmpty: FetchResult | null = null;
  let lastError: Error | null = null;
  const statuses: number[] = [];

  for (const ua of candidates) {
    let attempt: FetchOnceResult;
    try {
      attempt = await fetchOnce(fetchImpl, url, ua, timeoutMs);
    } catch (err) {
      // 连不上 / 超时 / 代理拒绝 / 超出大小上限都与 UA 无关,换 UA 只会把同一个错误再等 N 遍
      // (代理挂掉时最坏 N × 30s)。直接抛,让上层换线路或回退旧 cache。
      const reason = describeFetchError(err);
      logger.warn({ providerId: provider.id, url: logUrl, userAgent: ua, egress: egressName, reason }, "Provider fetch errored");
      throw new Error(reason, { cause: err });
    }
    if (!attempt.ok) {
      statuses.push(attempt.status);
      lastError = new Error(describeHttpStatus(attempt.status, statuses, egressName));
      logger.warn(
        { providerId: provider.id, url: logUrl, userAgent: ua, status: attempt.status, egress: egressName },
        "Provider fetch non-2xx, trying next UA",
      );
      continue;
    }
    const result: FetchResult = {
      text: attempt.text,
      userinfo_header: attempt.userinfo_header,
      fetched_at: Date.now(),
      used_user_agent: ua,
    };
    if (attempt.text.trim().length === 0) {
      lastOkEmpty = result;
      logger.info(
        { providerId: provider.id, url: logUrl, userAgent: ua, status: attempt.status },
        "Provider fetch 200 but empty body, trying next UA",
      );
      continue;
    }
    if (!parsesToNodes(attempt.text)) {
      firstUnusable ??= result;
      logger.info(
        { providerId: provider.id, url: logUrl, userAgent: ua, bytes: attempt.text.length },
        "Provider fetch got content without nodes, trying next UA",
      );
      continue;
    }
    logger.info(
      {
        providerId: provider.id,
        status: attempt.status,
        bytes: attempt.text.length,
        userAgent: ua,
        hasUserinfo: !!attempt.userinfo_header,
        egress: egressName,
      },
      "Provider HTTP fetch ok",
    );
    return { result, usable: true };
  }

  const fallback = firstUnusable ?? lastOkEmpty;
  if (fallback) {
    logger.warn(
      { providerId: provider.id, url: logUrl, triedUserAgents: candidates, gotContent: !!firstUnusable },
      "Provider fetch: no User-Agent returned parseable nodes",
    );
    return { result: fallback, usable: false };
  }
  // 全部非 2xx:抛出最后一个错误,不掩盖真实 HTTP 错误
  logger.warn({ providerId: provider.id, url: logUrl }, "Provider fetch failed for all User-Agents");
  throw lastError ?? new Error("Provider fetch failed: no response");
}

/**
 * 换遍 UA 全是 403:绝大多数是机场 / Cloudflare 按来源 IP 拦截(境外服务器、机房 IP),
 * 而不是 UA 问题。把这个判断写进报错,指给用户「出口」。
 */
function describeHttpStatus(status: number, statuses: number[], egressName: string | undefined): string {
  if (!statuses.every((s) => s === 403)) return `HTTP ${status}`;
  return egressName
    ? `HTTP ${status}(上游也拦了这台出口机的 IP,常见于机房 IP)`
    : `HTTP ${status}(上游拒绝了服务器的请求,常见于按来源 IP 拦截境外服务器;可添加「出口」借其它机器的网络,再在节点源的拉取线路里选上)`;
}

function redactSubscriptionUrl(url: string): string {
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return "(invalid url)";
  }
}
