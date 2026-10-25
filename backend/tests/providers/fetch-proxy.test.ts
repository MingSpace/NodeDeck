import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { fetchProviderContent } from "../../src/providers/fetcher.js";
import { describeFetchError, redactProxyUrl } from "../../src/providers/fetch-proxy.js";
import { providerSchema } from "../../src/schemas/provider.js";
import { providerActionsRouter } from "../../src/routes/provider-actions.js";

// 真起一个上游 + 一个 CONNECT 代理,验证走代理时请求确实经过代理(而不是 mock 掉 undici)。
let upstream: http.Server;
let proxy: http.Server;
let upstreamUrl = "";
let proxyUrl = "";
const proxiedTargets: string[] = [];

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

beforeAll(async () => {
  upstream = http.createServer((_req, res) => {
    res.setHeader("subscription-userinfo", "upload=1; download=2; total=10; expire=0");
    res.end("ss://YWVzLTI1Ni1nY206cHc=@1.2.3.4:443#via-proxy\n");
  });
  upstreamUrl = `http://127.0.0.1:${await listen(upstream)}/sub`;

  proxy = http.createServer((_req, res) => {
    res.statusCode = 405;
    res.end();
  });
  proxy.on("connect", (req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer) => {
    proxiedTargets.push(req.url ?? "");
    const [host, port] = (req.url ?? "").split(":");
    const upstreamSocket = net.connect(Number(port), host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      upstreamSocket.write(head);
      upstreamSocket.pipe(clientSocket);
      clientSocket.pipe(upstreamSocket);
    });
    upstreamSocket.on("error", () => clientSocket.destroy());
  });
  proxyUrl = `http://127.0.0.1:${await listen(proxy)}`;
});

afterAll(async () => {
  proxy.closeAllConnections();
  upstream.closeAllConnections();
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => upstream.close(r));
});

afterEach(() => {
  vi.unstubAllGlobals();
  proxiedTargets.length = 0;
});

describe("fetchProviderContent - 拉取代理", () => {
  it("配了 fetch_proxy 时经代理拉取,不走全局 fetch", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);

    const result = await fetchProviderContent({
      id: "p1",
      type: "http",
      url: upstreamUrl,
      user_agent: "",
      fetch_proxy: proxyUrl,
    });

    expect(result.text).toContain("via-proxy");
    expect(result.userinfo_header).toContain("total=10");
    expect(proxiedTargets).toHaveLength(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("代理连不上时立即失败,报错带代理地址且不换 UA 重试", async () => {
    // 先占一个端口再关掉,拿到一个必然 ECONNREFUSED 的地址
    const tmp = http.createServer();
    const deadPort = await listen(tmp);
    await new Promise((r) => tmp.close(r));

    const started = Date.now();
    await expect(
      fetchProviderContent({
        id: "p1",
        type: "http",
        url: upstreamUrl,
        user_agent: "",
        fetch_proxy: `http://user:secret@127.0.0.1:${deadPort}`,
      }),
    ).rejects.toThrow(new RegExp(`经代理 http://127\\.0\\.0\\.1:${deadPort} 拉取失败: .*ECONNREFUSED`));
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});

describe("fetchProviderContent - 直连错误处理", () => {
  it("网络错误不换 UA 重试", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ETIMEDOUT 1.2.3.4:443") });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchProviderContent({ id: "p1", type: "http", url: "https://airport.example/sub", user_agent: "" }),
    ).rejects.toThrow("fetch failed: connect ETIMEDOUT 1.2.3.4:443");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("全部 403 时报错提示可能是按来源 IP 拦截", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, headers: { get: () => null }, body: null }) as unknown as Response),
    );

    await expect(
      fetchProviderContent({ id: "p1", type: "http", url: "https://airport.example/sub", user_agent: "" }),
    ).rejects.toThrow(/HTTP 403.*拉取代理/);
  });
});

describe("fetch-proxy helpers", () => {
  it("redactProxyUrl 去掉账号密码", () => {
    expect(redactProxyUrl("socks5://u:p@10.0.0.1:1080")).toBe("socks5://10.0.0.1:1080");
    expect(redactProxyUrl("not a url")).toBe("(invalid proxy url)");
  });

  it("describeFetchError 展开 cause 链,超时单独说明", () => {
    const err = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:1") });
    expect(describeFetchError(err)).toBe("fetch failed: connect ECONNREFUSED 127.0.0.1:1");
    expect(describeFetchError(new DOMException("aborted", "AbortError"))).toBe("请求超时");
  });
});

describe("providerSchema.fetch_proxy", () => {
  const base = { id: "p1", name: "p", type: "http", url: "https://airport.example/sub" };

  it.each(["http://172.18.0.1:18888", "https://proxy.example:8443", "socks5://127.0.0.1:1080"])(
    "接受 %s",
    (fetch_proxy) => {
      expect(providerSchema.safeParse({ ...base, fetch_proxy }).success).toBe(true);
    },
  );

  it("空串视为未配置", () => {
    const parsed = providerSchema.parse({ ...base, fetch_proxy: "  " });
    expect(parsed.fetch_proxy).toBeUndefined();
  });

  it("拒绝不支持的协议和非 URL", () => {
    expect(providerSchema.safeParse({ ...base, fetch_proxy: "ftp://1.2.3.4:21" }).success).toBe(false);
    expect(providerSchema.safeParse({ ...base, fetch_proxy: "172.18.0.1:18888" }).success).toBe(false);
  });
});

describe("POST /api/providers/test-fetch", () => {
  function post(body: unknown) {
    return providerActionsRouter.request("/test-fetch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("配了代理时同时测经代理与直连,只解析不落 cache", async () => {
    const res = await post({ url: upstreamUrl, fetch_proxy: proxyUrl });
    expect(res.status).toBe(200);
    const { attempts } = (await res.json()) as {
      attempts: Array<{ route: string; ok: boolean; node_count: number; has_userinfo: boolean }>;
    };
    expect(attempts.map((a) => a.route)).toEqual(["proxy", "direct"]);
    for (const a of attempts) {
      expect(a).toMatchObject({ ok: true, node_count: 1, has_userinfo: true });
    }
    expect(proxiedTargets).toHaveLength(1);
  });

  it("代理地址非法时 400 并给出可读原因", async () => {
    const res = await post({ url: upstreamUrl, fetch_proxy: "ftp://1.2.3.4" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("socks5");
  });
});
