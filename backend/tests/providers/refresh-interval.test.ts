import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "../../src/schemas/provider.js";
import type { ProviderCache } from "../../src/providers/cache-store.js";

// 全部 storage / fetcher 都 mock,避免触碰真实文件系统与网络。
vi.mock("../../src/providers/cache-store.js", () => ({
  readProviderCache: vi.fn(),
  writeProviderCache: vi.fn(),
}));
vi.mock("../../src/providers/fetcher.js", () => ({
  fetchProviderContent: vi.fn(),
}));
vi.mock("../../src/storage/repos.js", () => ({
  providerRepo: { list: vi.fn() },
}));

import {
  readProviderCache,
  writeProviderCache,
} from "../../src/providers/cache-store.js";
import { fetchProviderContent } from "../../src/providers/fetcher.js";
import {
  refreshProvider,
  loadProviderNodes,
  refreshAllProviders,
} from "../../src/providers/load.js";
import { providerSchema } from "../../src/schemas/provider.js";
import { providerRepo } from "../../src/storage/repos.js";

const mockedReadCache = readProviderCache as unknown as ReturnType<typeof vi.fn>;
const mockedWriteCache = writeProviderCache as unknown as ReturnType<typeof vi.fn>;
const mockedFetch = fetchProviderContent as unknown as ReturnType<typeof vi.fn>;
const mockedRepoList = providerRepo.list as unknown as ReturnType<typeof vi.fn>;

function fakeProvider(refresh: Provider["refresh"]): Provider {
  return providerSchema.parse({
    id: "p1",
    name: "P1",
    type: "inline",
    content: "ss://YWVzLTEyOC1nY206cGFzc0AxLjEuMS4xOjEwODA=#t",
    refresh,
  }) as Provider;
}

function okCache(ageMin: number, nodes: ProviderCache["nodes"] = [{ type: "ss", name: "n", server: "1.1.1.1", port: 1080, cipher: "aes-128-gcm", password: "pass" } as ProviderCache["nodes"][number]]): ProviderCache {
  return {
    provider_id: "p1",
    fetched_at: Date.now() - ageMin * 60_000,
    status: "ok",
    nodes,
  };
}

beforeEach(() => {
  mockedReadCache.mockReset();
  mockedWriteCache.mockReset().mockResolvedValue(undefined);
  mockedFetch.mockReset().mockResolvedValue({
    text: "ss://YWVzLTEyOC1nY206cGFzc0AyLjIuMi4yOjIwODA=#t2",
    userinfo_header: null,
    fetched_at: Date.now(),
  });
  mockedRepoList.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("refresh schema", () => {
  it("显式 interval 直接通过", () => {
    const p = providerSchema.parse({
      id: "p",
      name: "P",
      type: "inline",
      content: "x",
      refresh: { interval: "12h" },
    });
    expect(p.refresh.interval).toBe("12h");
  });

  it("无 refresh 字段使用默认 12h", () => {
    const p = providerSchema.parse({
      id: "p",
      name: "P",
      type: "inline",
      content: "x",
    });
    expect(p.refresh.interval).toBe("12h");
  });
});

describe("refreshProvider - never(手动刷新)模式", () => {
  it("non-force 路径(scheduler / loadProviderNodes)下,有 ok cache 直接复用,不去 fetch", async () => {
    const provider = fakeProvider({ interval: "never" });
    const cached = okCache(99999);
    mockedReadCache.mockResolvedValue(cached);

    const result = await refreshProvider(provider, { force: false });

    expect(result).toBe(cached);
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedWriteCache).not.toHaveBeenCalled();
  });

  it("force=true(用户手动点刷新)穿透到 fetch 并写回新 cache", async () => {
    const provider = fakeProvider({ interval: "never" });
    const cached = okCache(99999);
    mockedReadCache.mockResolvedValue(cached);

    const result = await refreshProvider(provider, { force: true });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedWriteCache).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
  });

  it("无 cache 时仍然拉一次种子并写入(non-force 也会拉,避免初始化时空跑)", async () => {
    const provider = fakeProvider({ interval: "never" });
    mockedReadCache.mockResolvedValue(null);

    const result = await refreshProvider(provider);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedWriteCache).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
  });

  it("有 cache 但 status=stale 时 non-force 仍 short-circuit,不自动重拉(手动源失败后不该被 scheduler 反复重拉 + 每天推失败通知)", async () => {
    const provider = fakeProvider({ interval: "never" });
    const cached = { ...okCache(99999), status: "stale" as const, error: "HTTP 403" };
    mockedReadCache.mockResolvedValue(cached);

    const result = await refreshProvider(provider);

    expect(result).toBe(cached);
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedWriteCache).not.toHaveBeenCalled();
  });

  it("有 cache 但 status=error(种子失败)时 non-force 也 short-circuit,只靠用户手动 force 重试", async () => {
    const provider = fakeProvider({ interval: "never" });
    const cached = { ...okCache(99999, []), status: "error" as const, error: "HTTP 403" };
    mockedReadCache.mockResolvedValue(cached);

    const result = await refreshProvider(provider);

    expect(result).toBe(cached);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("status=stale 但 force=true(用户手动点刷新)仍穿透 fetch", async () => {
    const provider = fakeProvider({ interval: "never" });
    mockedReadCache.mockResolvedValue({ ...okCache(99999), status: "stale" as const, error: "HTTP 403" });

    await refreshProvider(provider, { force: true });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe("refreshProvider - on_request 模式", () => {
  it("有 cache 仍然总是穿透到 fetch", async () => {
    const provider = fakeProvider({ interval: "on_request" });
    mockedReadCache.mockResolvedValue(okCache(0.1));

    await refreshProvider(provider);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("loadProviderNodes 在 on_request 模式下必触发 fetch", async () => {
    const provider = fakeProvider({ interval: "on_request" });
    mockedReadCache.mockResolvedValue(okCache(0.1));

    await loadProviderNodes(provider);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe("refreshProvider - 周期模式 (4h)", () => {
  it("cache age < 240min 直接返回 cache", async () => {
    const provider = fakeProvider({ interval: "4h" });
    const cached = okCache(100);
    mockedReadCache.mockResolvedValue(cached);

    const result = await refreshProvider(provider);

    expect(result).toBe(cached);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("cache age >= 240min 触发重拉", async () => {
    const provider = fakeProvider({ interval: "4h" });
    mockedReadCache.mockResolvedValue(okCache(241));

    await refreshProvider(provider);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("force=true 总是重拉,无视 cache 新旧", async () => {
    const provider = fakeProvider({ interval: "4h" });
    mockedReadCache.mockResolvedValue(okCache(0.1));

    await refreshProvider(provider, { force: true });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});

describe("loadProviderNodes - 非 on_request 模式优先走 cache", () => {
  it("cache 有节点直接返回,不调用 refreshProvider", async () => {
    const provider = fakeProvider({ interval: "12h" });
    mockedReadCache.mockResolvedValue(okCache(99999));

    await loadProviderNodes(provider);

    expect(mockedFetch).not.toHaveBeenCalled();
  });
});

describe("refreshProvider - 解析出 0 节点时写 error 状态", () => {
  // 原行为:无论解析结果如何都写 status:"ok",前端看到绿色徽标 "0 个节点"——但其实是错误。
  // 修复后:nodes.length===0 时应写 status:"error" 并附具体原因,前端能给出有用反馈。
  it("inline content 为空时 → status:error + 'content 为空'", async () => {
    const provider = fakeProvider({ interval: "never" });
    mockedReadCache.mockResolvedValue(null);
    mockedFetch.mockResolvedValue({
      text: "",
      userinfo_header: null,
      fetched_at: Date.now(),
    });

    const result = await refreshProvider(provider);

    expect(result.status).toBe("error");
    expect(result.nodes).toHaveLength(0);
    expect(result.error).toMatch(/为空|empty/i);
  });

  it("content 非空但解析不出任何节点时 → status:error + '未识别到任何节点'", async () => {
    const provider = fakeProvider({ interval: "never" });
    mockedReadCache.mockResolvedValue(null);
    mockedFetch.mockResolvedValue({
      text: "this is just garbage text that no parser recognizes",
      userinfo_header: null,
      fetched_at: Date.now(),
    });

    const result = await refreshProvider(provider);

    expect(result.status).toBe("error");
    expect(result.nodes).toHaveLength(0);
    expect(result.error).toMatch(/未识别|0 .{0,5}节点/);
  });

  it("正常解析出至少 1 个节点时仍是 status:ok", async () => {
    const provider = fakeProvider({ interval: "never" });
    mockedReadCache.mockResolvedValue(null);
    mockedFetch.mockResolvedValue({
      text: "ss://YWVzLTEyOC1nY206cGFzc0AyLjIuMi4yOjIwODA=#t",
      userinfo_header: null,
      fetched_at: Date.now(),
    });

    const result = await refreshProvider(provider);

    expect(result.status).toBe("ok");
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();
  });
});

describe("refreshProvider - 解析并缓存上游 hosts 段(emit_hosts 自动带出的数据源)", () => {
  it("Clash 顶层 hosts: 中命中节点域名的条目被解析进 cache.extracted_hosts", async () => {
    const provider = fakeProvider({ interval: "12h" });
    mockedReadCache.mockResolvedValue(null);
    mockedFetch.mockResolvedValue({
      text: [
        "proxies:",
        "  - { name: HK, type: ss, server: hk.example.com, port: 8388, cipher: aes-128-gcm, password: pass }",
        "hosts:",
        "  '*.example.com': server:https://doh.example/dns-query",
        "",
      ].join("\n"),
      userinfo_header: null,
      fetched_at: Date.now(),
    });

    const result = await refreshProvider(provider, { force: true });

    expect(result.status).toBe("ok");
    expect(result.extracted_hosts).toEqual({
      "*.example.com": "server:https://doh.example/dns-query",
    });
  });

  it("hosts: 段与节点域名无关时被过滤(节点 server 为 IP / 仅国内域名分流)", async () => {
    const provider = fakeProvider({ interval: "12h" });
    mockedReadCache.mockResolvedValue(null);
    mockedFetch.mockResolvedValue({
      text: [
        "proxies:",
        "  - { name: HK, type: ss, server: 1.2.3.4, port: 8388, cipher: aes-128-gcm, password: pass }",
        "hosts:",
        "  taobao.com: server:223.6.6.6",
        "",
      ].join("\n"),
      userinfo_header: null,
      fetched_at: Date.now(),
    });

    const result = await refreshProvider(provider, { force: true });

    expect(result.status).toBe("ok");
    expect(result.extracted_hosts).toBeUndefined();
  });

  it("上游无 hosts 段时 extracted_hosts 为 undefined", async () => {
    const provider = fakeProvider({ interval: "12h" });
    mockedReadCache.mockResolvedValue(null);
    mockedFetch.mockResolvedValue({
      text: "ss://YWVzLTEyOC1nY206cGFzc0AyLjIuMi4yOjIwODA=#t",
      userinfo_header: null,
      fetched_at: Date.now(),
    });

    const result = await refreshProvider(provider, { force: true });

    expect(result.status).toBe("ok");
    expect(result.extracted_hosts).toBeUndefined();
  });
});

describe("refreshAllProviders - never(手动刷新)与 force 交互", () => {
  it("force=true(手动「刷新全部」)时,never 也一起拉,skippedLocked 为空", async () => {
    const manualProvider = fakeProvider({ interval: "never" });
    Object.assign(manualProvider, { id: "manual" });
    const normalProvider = fakeProvider({ interval: "4h" });
    Object.assign(normalProvider, { id: "normal" });

    mockedRepoList.mockResolvedValue([
      { id: "manual", data: manualProvider },
      { id: "normal", data: normalProvider },
    ]);
    mockedReadCache.mockImplementation(async (id: string) => {
      if (id === "manual") return okCache(99999);
      return null;
    });

    const result = await refreshAllProviders({ force: true });

    expect(result.skippedLocked).toEqual([]);
    expect(result.refreshed).toHaveLength(2);
    expect(mockedFetch).toHaveBeenCalledTimes(2);
  });

  it("force=false(理论上的兜底路径)时,never+ok 仍进 skippedLocked", async () => {
    const manualProvider = fakeProvider({ interval: "never" });
    Object.assign(manualProvider, { id: "manual" });
    const normalProvider = fakeProvider({ interval: "4h" });
    Object.assign(normalProvider, { id: "normal" });

    mockedRepoList.mockResolvedValue([
      { id: "manual", data: manualProvider },
      { id: "normal", data: normalProvider },
    ]);
    mockedReadCache.mockImplementation(async (id: string) => {
      if (id === "manual") return okCache(99999);
      return null;
    });

    const result = await refreshAllProviders({ force: false });

    expect(result.skippedLocked).toEqual(["manual"]);
    expect(result.refreshed).toHaveLength(1);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
