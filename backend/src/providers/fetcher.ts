import { readFile } from "node:fs/promises";
import type { Provider } from "../schemas/provider.js";
import { logger } from "../logger.js";

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
>;

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
async function fetchOnce(url: string, userAgent: string): Promise<FetchOnceResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
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

export async function fetchProviderContent(provider: ProviderFetchInput): Promise<FetchResult> {
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
  const url = provider.url!;

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

  for (const ua of candidates) {
    let attempt: FetchOnceResult;
    try {
      attempt = await fetchOnce(url, ua);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      logger.warn({ err, providerId: provider.id, url, userAgent: ua }, "Provider fetch attempt errored, trying next UA");
      continue;
    }
    if (!attempt.ok) {
      lastError = new Error(`HTTP ${attempt.status}`);
      logger.warn(
        { providerId: provider.id, url, userAgent: ua, status: attempt.status },
        "Provider fetch non-2xx, trying next UA",
      );
      continue;
    }
    if (attempt.text.trim().length === 0) {
      lastOkEmpty = { userinfo_header: attempt.userinfo_header, ua };
      logger.info(
        { providerId: provider.id, url, userAgent: ua, status: attempt.status },
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
      { providerId: provider.id, url, triedUserAgents: candidates },
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
  logger.warn({ providerId: provider.id, url }, "Provider fetch failed for all User-Agents");
  throw lastError ?? new Error("Provider fetch failed: no response");
}
