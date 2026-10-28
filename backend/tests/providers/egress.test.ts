import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import http from "node:http";
import net from "node:net";
import { mkdirSync, rmSync, statSync } from "node:fs";
import type { AddressInfo } from "node:net";
import ssh2 from "ssh2";

// DATA_DIR 指向临时目录:SSH 出口密钥、egress yaml 都写在这里,不污染仓库 data/。
const DATA_DIR = vi.hoisted(
  () => `${process.env.TMPDIR?.replace(/\/$/, "") ?? "/tmp"}/nodedeck-egress-${process.pid}`,
);
vi.mock("../../src/env.js", () => ({
  env: {
    NODE_ENV: "test",
    PORT: 8080,
    DATA_DIR,
    INITIAL_PASSWORD: "changeme",
    SESSION_SECRET: "test-secret-test-secret",
    LOG_LEVEL: "info",
    LOG_BUFFER_SIZE: 10,
  },
}));

import { fetchProviderContent } from "../../src/providers/fetcher.js";
import { describeFetchError, redactProxyUrl } from "../../src/providers/fetch-proxy.js";
import { hostKeyFingerprint } from "../../src/providers/egress.js";
import { getEgressKeyPair } from "../../src/providers/egress-key.js";
import { egressSchema, resolveFetchRoutes, type Egress } from "../../src/schemas/egress.js";
import { providerSchema } from "../../src/schemas/provider.js";
import { egressRepo } from "../../src/storage/repos.js";
import { providerActionsRouter } from "../../src/routes/provider-actions.js";
import { egressActionsRouter } from "../../src/routes/egress-actions.js";

// 真起一个上游 + 一个 CONNECT 代理 + 一个 SSH 服务器,验证请求确实经过出口(而不是 mock 掉 undici)。
let upstream: http.Server;
let proxy: http.Server;
let sshServer: ssh2.Server;
let upstreamUrl = "";
let proxyUrl = "";
let sshPort = 0;
let sshHostKeyFp = "";
const proxiedTargets: string[] = [];
const tunnelTargets: string[] = [];

function listen(server: http.Server | ssh2.Server): Promise<number> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
}

function egress(overrides: Partial<Egress> & Pick<Egress, "type">): Egress {
  return egressSchema.parse({ id: "eg-test", name: "测试出口", ...overrides });
}

const sshEgress = (overrides: Partial<Egress> = {}) =>
  egress({ type: "ssh", host: "127.0.0.1", port: sshPort, username: "u", auth: "password", password: "pw", ...overrides });

const loadOnly = (...list: Egress[]) => async (id: string) => list.find((e) => e.id === id) ?? null;

beforeAll(async () => {
  mkdirSync(DATA_DIR, { recursive: true });
  upstream = http.createServer((_req, res) => {
    res.setHeader("subscription-userinfo", "upload=1; download=2; total=10; expire=0");
    res.end("ss://YWVzLTI1Ni1nY206cHc=@1.2.3.4:443#via-egress\n");
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

  const hostKey = ssh2.utils.generateKeyPairSync("ed25519").private;
  const parsedHostKey = ssh2.utils.parseKey(hostKey) as ssh2.ParsedKey;
  sshHostKeyFp = hostKeyFingerprint(parsedHostKey.getPublicSSH());
  // 只认 NodeDeck 自己的出口公钥(测 key 登录)和 u / pw(测密码登录)
  const allowedKey = ssh2.utils.parseKey(getEgressKeyPair().publicKey) as ssh2.ParsedKey;
  sshServer = new ssh2.Server({ hostKeys: [hostKey] }, (client) => {
    client.on("error", () => undefined);
    client.on("authentication", (ctx) => {
      if (ctx.method === "password" && ctx.username === "u" && ctx.password === "pw") return ctx.accept();
      if (
        ctx.method === "publickey" &&
        ctx.key.algo === allowedKey.type &&
        ctx.key.data.equals(allowedKey.getPublicSSH()) &&
        (!ctx.signature || allowedKey.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) === true)
      ) {
        return ctx.accept();
      }
      ctx.reject();
    });
    client.on("ready", () => {
      client.on("tcpip", (accept, reject, info) => {
        tunnelTargets.push(`${info.destIP}:${info.destPort}`);
        const up = net.connect(info.destPort, info.destIP, () => {
          const channel = accept();
          channel.pipe(up).pipe(channel);
        });
        up.on("error", () => reject());
      });
    });
  });
  sshPort = await listen(sshServer);
});

afterAll(async () => {
  proxy.closeAllConnections();
  upstream.closeAllConnections();
  await new Promise((r) => proxy.close(r));
  await new Promise((r) => upstream.close(r));
  await new Promise((r) => sshServer.close(r));
  rmSync(DATA_DIR, { recursive: true, force: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
  proxiedTargets.length = 0;
  tunnelTargets.length = 0;
});

const httpInput = (fetch_via: string[]) => ({ id: "p1", type: "http" as const, url: upstreamUrl, fetch_via });

describe("fetchProviderContent - 出口", () => {
  it("代理出口:经代理拉取,不走全局 fetch", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);
    const eg = egress({ id: "eg-proxy", type: "proxy", url: proxyUrl });

    const result = await fetchProviderContent(httpInput(["eg-proxy"]), { loadEgress: loadOnly(eg) });

    expect(result.text).toContain("via-egress");
    expect(result.userinfo_header).toContain("total=10");
    expect(proxiedTargets).toHaveLength(1);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("SSH 出口(密码):请求经 direct-tcpip 通道到上游", async () => {
    const globalFetch = vi.fn();
    vi.stubGlobal("fetch", globalFetch);

    const result = await fetchProviderContent(httpInput(["eg-test"]), { loadEgress: loadOnly(sshEgress()) });

    expect(result.text).toContain("via-egress");
    expect(tunnelTargets).toEqual([`127.0.0.1:${new URL(upstreamUrl).port}`]);
    expect(globalFetch).not.toHaveBeenCalled();
  });

  it("SSH 出口(NodeDeck 密钥):用 data/egress_ed25519 登录,私钥 0600", async () => {
    const eg = sshEgress({ auth: "key", password: undefined, host_key: sshHostKeyFp });
    const result = await fetchProviderContent(httpInput(["eg-test"]), { loadEgress: loadOnly(eg) });

    expect(result.text).toContain("via-egress");
    expect(getEgressKeyPair().publicKey).toMatch(/^ssh-ed25519 \S+ nodedeck-egress$/);
    expect(statSync(`${DATA_DIR}/egress_ed25519`).mode & 0o777).toBe(0o600);
  });

  it("SSH 密码错误:报登录被拒绝", async () => {
    await expect(
      fetchProviderContent(httpInput(["eg-test"]), {
        loadEgress: loadOnly(sshEgress({ password: "wrong" })),
        route: "eg-test",
      }),
    ).rejects.toThrow(/SSH 登录 u@127\.0\.0\.1:\d+ 被拒绝,检查用户名和密码/);
  });

  it("SSH 主机指纹不符:拒连并给出实际指纹", async () => {
    const pinned = `SHA256:${"A".repeat(43)}`;
    await expect(
      fetchProviderContent(httpInput(["eg-test"]), {
        loadEgress: loadOnly(sshEgress({ host_key: pinned })),
        route: "eg-test",
      }),
    ).rejects.toThrow(`实际 ${sshHostKeyFp}`);
    expect(tunnelTargets).toHaveLength(0);
  });

  it("前一条线路失败换下一条", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ss://YWVzLTI1Ni1nY206cHc=@1.2.3.4:443#direct\n", { status: 200 })),
    );
    const dead = egress({ id: "eg-dead", name: "坏出口", type: "ssh", host: "127.0.0.1", port: 1, auth: "password", password: "x" });

    const result = await fetchProviderContent(httpInput(["eg-dead", "direct"]), { loadEgress: loadOnly(dead) });
    expect(result.text).toContain("#direct");
  });

  it("fetch_via 没写 direct 时直连排在最后兜底", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ss://YWVzLTI1Ni1nY206cHc=@1.2.3.4:443#direct\n", { status: 200 })),
    );
    const dead = egress({ id: "eg-dead", name: "坏出口", type: "ssh", host: "127.0.0.1", port: 1, auth: "password", password: "x" });

    const result = await fetchProviderContent(httpInput(["eg-dead"]), { loadEgress: loadOnly(dead) });
    expect(result.text).toContain("#direct");
  });

  it("direct 写在前面就先直连", async () => {
    const globalFetch = vi.fn(async () => new Response("ss://YWVzLTI1Ni1nY206cHc=@1.2.3.4:443#direct\n", { status: 200 }));
    vi.stubGlobal("fetch", globalFetch);
    const eg = egress({ id: "eg-proxy", type: "proxy", url: proxyUrl });

    const result = await fetchProviderContent(httpInput(["direct", "eg-proxy"]), { loadEgress: loadOnly(eg) });
    expect(result.text).toContain("#direct");
    expect(proxiedTargets).toHaveLength(0);
  });

  it("resolveFetchRoutes:空 = 只直连,没写 direct 补在最后,写了按原位置", () => {
    expect(resolveFetchRoutes([])).toEqual(["direct"]);
    expect(resolveFetchRoutes(["a", "b"])).toEqual(["a", "b", "direct"]);
    expect(resolveFetchRoutes(["direct", "a"])).toEqual(["direct", "a"]);
  });

  it("全部线路失败时逐条列出原因;出口不存在单独说明", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, headers: { get: () => null }, body: null }) as unknown as Response),
    );

    await expect(
      fetchProviderContent(httpInput(["eg-gone", "eg-test", "direct"]), {
        loadEgress: loadOnly(sshEgress({ password: "wrong" })),
      }),
    ).rejects.toThrow(/^出口 eg-gone: 不存在\(可能已删除\);经 测试出口: .*SSH 登录.*;直连: HTTP 403/);
  });
});

describe("fetchProviderContent - 直连错误处理", () => {
  it("网络错误不换 UA 重试", async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed", { cause: new Error("connect ETIMEDOUT 1.2.3.4:443") });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchProviderContent({ id: "p1", type: "http", url: "https://airport.example/sub" }),
    ).rejects.toThrow("fetch failed: connect ETIMEDOUT 1.2.3.4:443");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("全部 403 时报错提示可能是按来源 IP 拦截,指向出口", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 403, headers: { get: () => null }, body: null }) as unknown as Response),
    );

    await expect(
      fetchProviderContent({ id: "p1", type: "http", url: "https://airport.example/sub" }),
    ).rejects.toThrow(/^HTTP 403.*「出口」/);
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

describe("schema", () => {
  it("SSH 出口默认 root@:22、密钥登录", () => {
    expect(egressSchema.parse({ id: "e", name: "e", type: "ssh", host: "1.2.3.4" })).toMatchObject({
      port: 22,
      username: "root",
      auth: "key",
    });
  });

  it.each([
    [{ type: "ssh" }, "主机地址"],
    [{ type: "ssh", host: "h", auth: "password" }, "密码"],
    [{ type: "proxy" }, "代理地址"],
    [{ type: "proxy", url: "ftp://1.2.3.4:21" }, "socks5"],
    [{ type: "ssh", host: "h", host_key: "MD5:aa" }, "SHA256"],
    [{ id: "direct", type: "ssh", host: "h" }, "保留给直连"],
  ])("拒绝 %o", (overrides, message) => {
    const r = egressSchema.safeParse({ id: "e", name: "e", ...overrides });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain(message);
  });

  it("空串字段视为未填", () => {
    const parsed = egressSchema.parse({ id: "e", name: "e", type: "ssh", host: "h", password: "", host_key: " ", url: "" });
    expect(parsed).not.toHaveProperty("password", "");
    expect(parsed.host_key).toBeUndefined();
  });

  it("节点源 fetch_via 默认空,拒绝重复", () => {
    const base = { id: "p1", name: "p", type: "http", url: "https://airport.example/sub" };
    expect(providerSchema.parse(base).fetch_via).toEqual([]);
    expect(providerSchema.safeParse({ ...base, fetch_via: ["a", "a"] }).success).toBe(false);
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

  it("每条线路单独测,出口失败不会借直连冒充成功", async () => {
    const res = await post({ url: upstreamUrl, fetch_via: ["eg-gone"] });
    const { attempts } = (await res.json()) as { attempts: Array<{ route: string; ok: boolean; error?: string }> };
    expect(attempts.map((a) => [a.route, a.ok])).toEqual([
      ["eg-gone", false],
      ["direct", true],
    ]);
    expect(attempts[0].error).toContain("不存在");
  });

  it("逐条测拉取线路,直连固定兜底总会测到;只解析不落 cache", async () => {
    await egressRepo.save(egress({ id: "eg-proxy", name: "代理机", type: "proxy", url: proxyUrl }));
    const res = await post({ url: upstreamUrl, fetch_via: ["eg-proxy"] });
    expect(res.status).toBe(200);
    const { attempts } = (await res.json()) as {
      attempts: Array<{ route: string; label: string; ok: boolean; node_count: number; has_userinfo: boolean }>;
    };
    expect(attempts.map((a) => [a.route, a.label])).toEqual([
      ["eg-proxy", "代理机"],
      ["direct", "服务器直连"],
    ]);
    for (const a of attempts) {
      expect(a).toMatchObject({ ok: true, node_count: 1, has_userinfo: true });
    }
    expect(proxiedTargets).toHaveLength(1);
  });

  it("URL 非法时 400 并给出可读原因", async () => {
    const res = await post({ url: "not-a-url" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("订阅 URL");
  });
});

describe("/api/egresses", () => {
  it("public-key 给出带限制选项的 authorized_keys 行", async () => {
    const res = await egressActionsRouter.request("/public-key");
    const body = (await res.json()) as { public_key: string; authorized_keys_line: string };
    expect(body.public_key).toBe(getEgressKeyPair().publicKey);
    expect(body.authorized_keys_line).toBe(
      `command="/bin/false",no-pty,no-agent-forwarding,no-X11-forwarding ${body.public_key}`,
    );
  });

  it("test 登录失败时报原因,同时带回主机指纹", async () => {
    const { id: _id, ...unsaved } = sshEgress({ password: "wrong" });
    const res = await egressActionsRouter.request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(unsaved),
    });
    const body = (await res.json()) as { ok: boolean; error: string; host_key: string };
    expect(body.ok).toBe(false);
    expect(body.error).toMatch(/^SSH 登录 .* 被拒绝/);
    expect(body.host_key).toBe(sshHostKeyFp);
  });
});
