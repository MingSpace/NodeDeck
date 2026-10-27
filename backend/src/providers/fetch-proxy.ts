import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

/**
 * 代理型出口(egress type=proxy):经现成的 http / socks5 代理拉订阅。SSH 型出口见 egress.ts。
 *
 * 为什么不用全局 fetch:容器是 Node 20,内置 fetch 不认 HTTP_PROXY,也不接受 npm 版 undici 的
 * dispatcher(两份 undici 内部版本不同)。所以走出口时整条请求都用 npm 版 undici 的 fetch;
 * 直连仍用全局 fetch。
 */
export interface ProxiedFetch {
  fetch: typeof globalThis.fetch;
  close: () => Promise<void>;
}

export function createProxiedFetch(proxyUrl: string): ProxiedFetch {
  // ProxyAgent 按协议分派:http/https 走 CONNECT 隧道,socks5:// 走 Socks5ProxyAgent(undici 标记实验性)。
  const dispatcher: Dispatcher = new ProxyAgent(proxyUrl);
  const proxied = ((input: string | URL, init?: RequestInit) =>
    undiciFetch(input, {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher,
    })) as unknown as typeof globalThis.fetch;
  return {
    fetch: proxied,
    close: () => dispatcher.close(),
  };
}

/** 日志 / 报错里展示代理地址时去掉账号密码。 */
export function redactProxyUrl(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "(invalid proxy url)";
  }
}

/**
 * undici / 内置 fetch 的网络错误 message 只有一句 "fetch failed",真正原因在 cause 链里
 * (ECONNREFUSED / ETIMEDOUT / 代理返回 407 …)。拼出来,用户才知道是代理没起还是上游不通。
 */
export function describeFetchError(err: unknown): string {
  if ((err as { name?: unknown } | null)?.name === "AbortError") return "请求超时";
  if (!(err instanceof Error)) return String(err);
  const parts = [err.message];
  let cause: unknown = (err as { cause?: unknown }).cause;
  for (let depth = 0; cause instanceof Error && depth < 3; depth++) {
    if (cause.message && !parts.includes(cause.message)) parts.push(cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(": ");
}
