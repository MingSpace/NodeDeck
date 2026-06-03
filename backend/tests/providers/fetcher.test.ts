import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchProviderContent, type ProviderFetchInput } from "../../src/providers/fetcher.js";

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

function httpInput(user_agent: string): ProviderFetchInput {
  return { id: "p1", type: "http", url: "https://airport.example/sub", user_agent };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchProviderContent - UA 网关空 body 自动回退", () => {
  it("空 UA 拿到 200 空 body 时,回退到 Clash 系 UA 拿内容", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const ua = uaOf(init);
      // 模拟 sparkcloud:非 clash UA(含空 UA)一律 200 空 body;clash UA 才吐 YAML。
      if (ua.toLowerCase().includes("clash")) {
        return makeRes({ ok: true, status: 200, text: "proxies:\n  - { name: a }\n" });
      }
      return makeRes({ ok: true, status: 200, text: "" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent(httpInput(""));

    expect(result.text).toContain("proxies");
    expect(result.used_user_agent?.toLowerCase()).toContain("clash");
    // 第一次空 UA 命中空 body,至少又试了一次 clash UA。
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(uaOf(fetchMock.mock.calls[0][1])).toBe("");
  });

  it("用户显式配置的 UA 一次成功时,不再尝试其它 UA", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const ua = uaOf(init);
      if (ua === "MyCustom/1.0") {
        return makeRes({ ok: true, status: 200, text: "ss://abc#n" });
      }
      return makeRes({ ok: true, status: 200, text: "" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent(httpInput("MyCustom/1.0"));

    expect(result.text).toBe("ss://abc#n");
    expect(result.used_user_agent).toBe("MyCustom/1.0");
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it("所有 UA 都 200 空 body 时,返回空文本(交给 load 报错)而非抛出", async () => {
    const fetchMock = vi.fn(async () => makeRes({ ok: true, status: 200, text: "" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent(httpInput(""));

    expect(result.text).toBe("");
    // 空 UA + 5 个回退 UA,均被尝试过。
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("所有 UA 都非 2xx 时抛出最后一个 HTTP 错误", async () => {
    const fetchMock = vi.fn(async () => makeRes({ ok: false, status: 403, text: "" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchProviderContent(httpInput(""))).rejects.toThrow(/403/);
  });

  it("inline 源直接回内容,不发请求", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProviderContent({
      id: "p2",
      type: "inline",
      content: "ss://inline#n",
      user_agent: "",
    });

    expect(result.text).toBe("ss://inline#n");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
