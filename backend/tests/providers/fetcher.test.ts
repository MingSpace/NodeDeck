import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviderContent, type ProviderFetchInput } from "../../src/providers/fetcher.js";
import { DEFAULT_USER_AGENTS, providerSchema } from "../../src/schemas/provider.js";

interface FakeResOpts {
  ok: boolean;
  status: number;
  text: string;
  userinfo?: string | null;
}

// body=null 让 fetcher 走 res.text() 分支,免去实现 ReadableStream reader。
function makeRes(opts: FakeResOpts) {
  return {
    ok: opts.ok,
    status: opts.status,
    statusText: opts.ok ? "OK" : "ERR",
    headers: {
      get: (k: string) =>
        k.toLowerCase() === "subscription-userinfo" ? (opts.userinfo ?? null) : null,
    },
    body: null,
    text: async () => opts.text,
  } as unknown as Response;
}

function uaOf(init: RequestInit | undefined): string {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers["user-agent"] ?? "";
}

const SS_LINE = "ss://YWVzLTI1Ni1nY206cHc=@1.2.3.4:443#n";
const CLASH_YAML = "proxies:\n  - { name: a, type: ss, server: 1.2.3.4, port: 443, cipher: aes-256-gcm, password: pw }\n";
const HTML_PAGE = "<!doctype html><html><body>请使用客户端订阅</body></html>";

function httpInput(user_agents?: string[]): ProviderFetchInput {
  return { id: "p1", type: "http", url: "https://airport.example/sub", user_agents };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchProviderContent - 按 User-Agent 列表依次尝试", () => {
  it("没配 user_agents 时用默认列表,第一个 UA 拿到节点就停", async () => {
    const fetchMock = vi.fn(async () => makeRes({ ok: true, status: 200, text: CLASH_YAML }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent(httpInput());

    expect(result.used_user_agent).toBe(DEFAULT_USER_AGENTS[0]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("默认列表 Clash Meta 系排在空 UA 前面", () => {
    const emptyAt = DEFAULT_USER_AGENTS.indexOf("");
    expect(emptyAt).toBeGreaterThan(0);
    for (const ua of DEFAULT_USER_AGENTS.slice(0, emptyAt)) expect(ua).toMatch(/meta|verge/i);
  });

  it("200 空 body 时换下一个 UA", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      makeRes({ ok: true, status: 200, text: uaOf(init) === "B/1" ? SS_LINE : "" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent(httpInput(["A/1", "B/1", "C/1"]));

    expect(result.text).toBe(SS_LINE);
    expect(result.used_user_agent).toBe("B/1");
    expect(fetchMock.mock.calls.map((c) => uaOf(c[1]))).toEqual(["A/1", "B/1"]);
  });

  it("有内容但解析不出节点(如「请使用客户端」页面)时也换下一个 UA", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      makeRes({ ok: true, status: 200, text: uaOf(init) === "" ? SS_LINE : HTML_PAGE }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent(httpInput(["A/1", ""]));

    expect(result.text).toBe(SS_LINE);
    expect(result.used_user_agent).toBe("");
  });

  it("没有 UA 能解析出节点时,回传最靠前的非空内容(交给 load 报「未识别到节点」)", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      makeRes({ ok: true, status: 200, text: uaOf(init) === "B/1" ? HTML_PAGE : "" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent(httpInput(["A/1", "B/1", "C/1"]));

    expect(result.text).toBe(HTML_PAGE);
    expect(result.used_user_agent).toBe("B/1");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("所有 UA 都 200 空 body 时,返回空文本而非抛出", async () => {
    const fetchMock = vi.fn(async () => makeRes({ ok: true, status: 200, text: "" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent(httpInput());

    expect(result.text).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(DEFAULT_USER_AGENTS.length);
  });

  it("preferUserAgent:先试上次可用的 UA,失败再按列表顺序往下(不重复试)", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      makeRes({ ok: true, status: 200, text: uaOf(init) === "A/1" ? SS_LINE : "" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent(httpInput(["A/1", "B/1", "C/1"]), { preferUserAgent: "C/1" });

    expect(result.used_user_agent).toBe("A/1");
    expect(fetchMock.mock.calls.map((c) => uaOf(c[1]))).toEqual(["C/1", "A/1"]);
  });

  it("preferUserAgent 不在列表里就忽略", async () => {
    const fetchMock = vi.fn(async () => makeRes({ ok: true, status: 200, text: SS_LINE }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchProviderContent(httpInput(["A/1"]), { preferUserAgent: "Gone/1" });

    expect(fetchMock.mock.calls.map((c) => uaOf(c[1]))).toEqual(["A/1"]);
  });

  it("配了 user_agents 就只试列表里的,不再混入默认列表", async () => {
    const fetchMock = vi.fn(async () => makeRes({ ok: true, status: 200, text: "" }));
    vi.stubGlobal("fetch", fetchMock);

    await fetchProviderContent(httpInput(["MyCustom/1.0"]));

    expect(fetchMock.mock.calls.map((c) => uaOf(c[1]))).toEqual(["MyCustom/1.0"]);
  });

  it("所有 UA 都非 2xx 时抛出最后一个 HTTP 错误", async () => {
    const fetchMock = vi.fn(async () => makeRes({ ok: false, status: 403, text: "" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProviderContent(httpInput())).rejects.toThrow(/403/);
  });

  it("inline 源直接回内容,不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent({ id: "p2", type: "inline", content: "ss://inline#n" });

    expect(result.text).toBe("ss://inline#n");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("providerSchema - user_agents", () => {
  const base = { id: "p1", name: "p", type: "http", url: "https://airport.example/sub" };

  it("旧版单值 user_agent 折成「先试它,再走默认列表」", () => {
    const p = providerSchema.parse({ ...base, user_agent: "Surge/2400" });
    expect(p.user_agents).toEqual(["Surge/2400", ...DEFAULT_USER_AGENTS]);
    expect(p).not.toHaveProperty("user_agent");
  });

  it("旧版空 user_agent 等于用默认列表", () => {
    expect(providerSchema.parse({ ...base, user_agent: "" }).user_agents).toEqual([]);
  });

  it("新旧字段都在时以 user_agents 为准", () => {
    expect(providerSchema.parse({ ...base, user_agent: "X/1", user_agents: ["Y/1"] }).user_agents).toEqual(["Y/1"]);
  });

  it("拒绝重复 UA;空字符串是合法候选", () => {
    expect(providerSchema.safeParse({ ...base, user_agents: ["a", "a"] }).success).toBe(false);
    expect(providerSchema.parse({ ...base, user_agents: ["", "a"] }).user_agents).toEqual(["", "a"]);
  });
});
