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

describe("refresh schema 迁移", () => {
  it("老格式 { interval_minutes: 60, on_demand: true } → 4h", () => {
    const p = providerSchema.parse({
      id: "p",
      name: "P",
      type: "inline",
      content: "x",
      refresh: { interval_minutes: 60, on_demand: true },
    });
    expect(p.refresh.interval).toBe("4h");
  });

  it("老格式 { interval_minutes: 60, on_demand: false } → never", () => {
    const p = providerSchema.parse({
      id: "p",
      name: "P",
      type: "inline",
      content: "x",
      refresh: { interval_minutes: 60, on_demand: false },
    });
    expect(p.refresh.interval).toBe("never");
  });

  it("老格式 interval_minutes 桶映射", () => {
    const cases: [number, string][] = [
      [240, "4h"],
      [241, "12h"],
      [720, "12h"],
      [721, "24h"],
      [1440, "24h"],
      [1441, "1week"],
      [10080, "1week"],
      [99999, "1week"],
    ];
    for (const [m, expected] of cases) {
      const p = providerSchema.parse({
        id: "p",
        name: "P",
        type: "inline",
        content: "x",
        refresh: { interval_minutes: m, on_demand: true },
      });
      expect(p.refresh.interval, `interval_minutes=${m}`).toBe(expected);
    }
  });

  it("新格式直接通过", () => {
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

describe("refreshProvider - never 模式", () => {
  it("已有 ok cache 时 short-circuit,即使 force=true 也不重拉", async () => {
    const provider = fakeProvider({ interval: "never" });
    const cached = okCache(99999);
    mockedReadCache.mockResolvedValue(cached);

    const result = await refreshProvider(provider, { force: true });

    expect(result).toBe(cached);
    expect(mockedFetch).not.toHaveBeenCalled();
    expect(mockedWriteCache).not.toHaveBeenCalled();
  });

  it("无 cache 时仍然拉一次种子并写入", async () => {
    const provider = fakeProvider({ interval: "never" });
    mockedReadCache.mockResolvedValue(null);

    const result = await refreshProvider(provider);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedWriteCache).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("ok");
  });

  it("有 cache 但 status=stale 时也允许重拉(种子未成功)", async () => {
    const provider = fakeProvider({ interval: "never" });
    mockedReadCache.mockResolvedValue({
      ...okCache(0),
      status: "stale",
    });

    await refreshProvider(provider);

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

describe("refreshAllProviders - never 跳过统计", () => {
  it("never+ok 的 provider 进 skippedLocked,其他正常 refresh", async () => {
    const lockedProvider = fakeProvider({ interval: "never" });
    Object.assign(lockedProvider, { id: "locked" });
    const normalProvider = fakeProvider({ interval: "4h" });
    Object.assign(normalProvider, { id: "normal" });

    mockedRepoList.mockResolvedValue([
      { id: "locked", data: lockedProvider },
      { id: "normal", data: normalProvider },
    ]);
    mockedReadCache.mockImplementation(async (id: string) => {
      if (id === "locked") return okCache(99999);
      return null;
    });

    const result = await refreshAllProviders({ force: true });

    expect(result.skippedLocked).toEqual(["locked"]);
    expect(result.refreshed).toHaveLength(1);
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
