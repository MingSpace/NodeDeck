import { readFile } from "node:fs/promises";
import type { Provider } from "../schemas/provider.js";
import { DIRECT_ROUTE, type Egress } from "../schemas/egress.js";
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
  "id" | "type" | "url" | "path" | "content" | "user_agent"
> &
  Partial<Pick<Provider, "fetch_via">>;

export interface FetchOptions {
  /** 单次请求超时;Web UI「测试拉取」用更短的值,免得页面干等。 */
  timeoutMs?: number;
  /** 按 id 取出口;默认读 data/egresses,测试里注入。 */
  loadEgress?: (id: string) => Promise<Egress | null>;
}

const FETCH_TIMEOUT_MS = 30_000;
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * 空 body 自动回退用的 UA 候选。很多机场按 User-Agent 网关:Surge 系 UA 返回 200 + 空 body,
 * 换成 Clash 系才吐内容(实测部分机场即如此)。把结构化的 Clash YAML UA 排在前面,
 * 既能拿到节点,也便于「从订阅抽取 hosts」命中顶层 hosts: 段。
 */
const FALLBACK_USER_AGENTS = [
  "clash-verge/v2.0.0",
  "ClashMetaForAndroid/2.11.0",
  "mihomo/1.18.0",
  "Clash/2023",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
];

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
 * 按 fetch_via 的顺序逐条线路拉取,拿到非空内容即返回;一条线路失败(连不上 / 全部 UA 非 2xx /
 * 全部空 body)才换下一条。全失败时把每条线路的原因拼在一起报,便于一眼看出卡在哪。
 */
async function fetchHttpViaRoutes(provider: ProviderFetchInput, opts: FetchOptions): Promise<FetchResult> {
  const routes = provider.fetch_via?.length ? provider.fetch_via : [DIRECT_ROUTE];
  const loadEgress = opts.loadEgress ?? defaultLoadEgress;
  const failures: string[] = [];
  let emptyResult: FetchResult | null = null;

  for (const route of routes) {
    let label = route === DIRECT_ROUTE ? "直连" : `出口 ${route}`;
    try {
      let result: FetchResult;
      if (route === DIRECT_ROUTE) {
        result = await fetchHttp(provider, globalThis.fetch, opts);
      } else {
        const egress = await loadEgress(route);
        if (!egress) throw new Error("不存在(可能已删除)");
        label = `经 ${egress.name}`;
        const routed = openEgressFetch(egress);
        try {
          result = await fetchHttp(provider, routed.fetch, opts, egress.name);
        } finally {
          // close 等在途请求结束;这里请求都已完成或已 abort,不会卡住
          await routed.close().catch(() => undefined);
        }
      }
      if (result.text.trim().length > 0) return result;
      emptyResult ??= result;
      failures.push(`${label}: 上游返回空内容`);
    } catch (err) {
      failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (routes.length > 1) {
      logger.warn({ providerId: provider.id, route, reason: failures.at(-1) }, "Provider fetch route failed, trying next");
    }
  }

  // 有线路拿到 200 空 body:回传空文本,由 load.ts 给出「已尝试多 UA 仍空」的提示
  if (emptyResult) return emptyResult;
  // 只有一条线路时原样报错,不加「直连:」前缀,与之前的报错一致
  if (routes.length === 1) throw new Error(failures[0].replace(/^直连: /, ""));
  throw new Error(failures.join(";"));
}

async function fetchHttp(
  provider: ProviderFetchInput,
  fetchImpl: typeof globalThis.fetch,
  opts: FetchOptions,
  egressName?: string,
): Promise<FetchResult> {
  const url = provider.url!;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  // 订阅 token 多在 query / path 里,日志会落盘并推到 Web UI,只记 host
  const logUrl = redactSubscriptionUrl(url);

  // 候选 UA = [用户配置(默认空), ...回退列表],去重保序。
  const configured = provider.user_agent ?? "";
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const ua of [configured, ...FALLBACK_USER_AGENTS]) {
    if (seen.has(ua)) continue;
    seen.add(ua);
    candidates.push(ua);
  }

  // 至少有一次 200 但 body 为空时记下来,用于"全空"时回传(让 load.ts 报更友好的错误)。
  let lastOkEmpty: { userinfo_header: string | null; ua: string } | null = null;
  let lastError: Error | null = null;
  const statuses: number[] = [];

  for (const ua of candidates) {
    let attempt: FetchOnceResult;
    try {
      attempt = await fetchOnce(fetchImpl, url, ua, timeoutMs);
    } catch (err) {
      // 连不上 / 超时 / 代理拒绝 / 超出大小上限都与 UA 无关,换 UA 只会把同一个错误再等 N 遍
      // (代理挂掉时最坏 6 × 30s)。直接抛,让 load.ts 回退旧 cache。
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
    if (attempt.text.trim().length === 0) {
      lastOkEmpty = { userinfo_header: attempt.userinfo_header, ua };
      logger.info(
        { providerId: provider.id, url: logUrl, userAgent: ua, status: attempt.status },
        "Provider fetch 200 but empty body, trying next UA",
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
    return {
      text: attempt.text,
      userinfo_header: attempt.userinfo_header,
      fetched_at: Date.now(),
      used_user_agent: ua,
    };
  }

  // 没有任何 UA 拿到非空内容。
  if (lastOkEmpty) {
    // 至少有一次 200 空响应:回传空文本,由 load.ts 给出"已尝试多 UA 仍空"的提示。
    logger.warn(
      { providerId: provider.id, url: logUrl, triedUserAgents: candidates },
      "Provider fetch: all User-Agents returned empty body",
    );
    return {
      text: "",
      userinfo_header: lastOkEmpty.userinfo_header,
      fetched_at: Date.now(),
      used_user_agent: lastOkEmpty.ua,
    };
  }
  // 全部非 2xx / 网络错误:抛出最后一个错误(沿用现行为,不掩盖真实 HTTP 错误)。
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
