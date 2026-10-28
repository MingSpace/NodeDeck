import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "../../src/schemas/provider.js";
import type { ProviderCache } from "../../src/providers/cache-store.js";

// 全部 storage / fetcher 都 mock,避免触碰真实文件系统与网络。
vi.mock("../../src/providers/cache-store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/providers/cache-store.js")>()),
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
  retryDelayMinutes,
  OFFLINE_AFTER_FAILURES,
} from "../../src/providers/load.js";
import { DEFAULT_USER_AGENTS, providerSchema } from "../../src/schemas/provider.js";
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

describe("refreshProvider - 上游流量用完 / 到期时缩短到每小时重拉", () => {
  const GB = 1024 ** 3;
  const httpProvider = (quota?: Record<string, unknown>) =>
    providerSchema.parse({
      id: "p1",
      name: "P1",
      type: "http",
      url: "https://sub.example.com/s",
      refresh: { interval: "24h" },
      ...(quota ? { quota } : {}),
    }) as Provider;

  it("上游显示流量用完:24h 周期下 cache 超过 60min 就重拉", async () => {
    const provider = httpProvider();
    mockedReadCache.mockResolvedValue({
      ...okCache(61),
      userinfo: { upload: 0, download: 150 * GB, total: 150 * GB, expire: 0 },
    });

    await refreshProvider(provider);

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("流量没用完:仍按原周期,不提前重拉", async () => {
    const provider = httpProvider();
    mockedReadCache.mockResolvedValue({
      ...okCache(61),
      userinfo: { upload: 0, download: 10 * GB, total: 150 * GB, expire: 0 },
    });

    await refreshProvider(provider);

    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("信息节点显示流量用完的在线源同样缩短", async () => {
    mockedReadCache.mockResolvedValue({
      ...okCache(61),
      info_quota: { traffic: { used: 150 * GB, total: 150 * GB } },
    });

    await refreshProvider(httpProvider());

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("离线源不缩短:重拉只是重新解析同一份文本", async () => {
    mockedReadCache.mockResolvedValue({
      ...okCache(61),
      userinfo: { upload: 0, download: 150 * GB, total: 150 * GB, expire: 0 },
    });

    await refreshProvider(fakeProvider({ interval: "24h" }));

    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it("auto_exclude 关闭时不缩短周期", async () => {
    const provider = httpProvider({ auto_exclude: false });
    mockedReadCache.mockResolvedValue({
      ...okCache(61),
      userinfo: { upload: 0, download: 150 * GB, total: 150 * GB, expire: 0 },
    });

    await refreshProvider(provider);

    expect(mockedFetch).not.toHaveBeenCalled();
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

describe("refreshProvider - 记住上次可用的 UA", () => {
  const httpProvider = (user_agents?: string[]) =>
    providerSchema.parse({
      id: "p1",
      name: "P1",
      type: "http",
      url: "https://airport.example/sub",
      user_agents,
    }) as Provider;

  it("拿到节点后把所用 UA 连同当时的 UA 列表写进 cache", async () => {
    mockedReadCache.mockResolvedValue(null);
    mockedFetch.mockResolvedValue({
      text: "ss://YWVzLTEyOC1nY206cGFzc0AyLjIuMi4yOjIwODA=#t2",
      userinfo_header: null,
      fetched_at: Date.now(),
      used_user_agent: "",
    });

    const cache = await refreshProvider(httpProvider(), { force: true });

    expect(cache.ua_memory).toEqual({ user_agent: "", list: DEFAULT_USER_AGENTS });
  });

  it("列表没改过:下次刷新把记住的 UA 交给 fetcher 先试", async () => {
    mockedReadCache.mockResolvedValue({ ...okCache(9999), ua_memory: { user_agent: "", list: DEFAULT_USER_AGENTS } });

    await refreshProvider(httpProvider(), { force: true });

    expect(mockedFetch.mock.calls[0][1]).toEqual({ preferUserAgent: "" });
  });

  it("列表改过(换顺序 / 增删):记忆作废,按新顺序试", async () => {
    mockedReadCache.mockResolvedValue({ ...okCache(9999), ua_memory: { user_agent: "B/1", list: ["A/1", "B/1"] } });

    await refreshProvider(httpProvider(["B/1", "A/1"]), { force: true });

    expect(mockedFetch.mock.calls[0][1]).toEqual({ preferUserAgent: undefined });
  });

  it("拉取失败回退旧 cache 时保留记忆", async () => {
    const memory = { user_agent: "B/1", list: ["A/1", "B/1"] };
    mockedReadCache.mockResolvedValue({ ...okCache(9999), ua_memory: memory });
    mockedFetch.mockRejectedValue(new Error("HTTP 403"));

    const cache = await refreshProvider(httpProvider(["A/1", "B/1"]), { force: true });

    expect(cache.status).toBe("stale");
    expect(cache.ua_memory).toEqual(memory);
  });
});

describe("refreshProvider - 远程源拿到内容却解析不出节点", () => {
  const httpProvider = () =>
    providerSchema.parse({
      id: "p1",
      name: "P1",
      type: "http",
      url: "https://airport.example/sub",
      refresh: { interval: "24h" },
    }) as Provider;

  it("有上次的节点:回退成 stale,节点、流量信息都保留,附上原因", async () => {
    const previous = { ...okCache(30), userinfo: { upload: 1, download: 2, total: 100 } };
    mockedReadCache.mockResolvedValue(previous);
    mockedFetch.mockResolvedValue({ text: "subscription link expired", userinfo_header: null, fetched_at: Date.now() });

    const cache = await refreshProvider(httpProvider(), { force: true });

    expect(cache.status).toBe("stale");
    expect(cache.nodes).toEqual(previous.nodes);
    expect(cache.userinfo).toEqual(previous.userinfo);
    expect(cache.fetched_at).toBe(previous.fetched_at);
    expect(cache.error).toMatch(/未识别/);
    expect(cache.retry?.failures).toBe(1);
    expect(mockedWriteCache).toHaveBeenCalledWith(cache);
  });

  it("从没拉到过节点:照旧写 error", async () => {
    mockedReadCache.mockResolvedValue(null);
    mockedFetch.mockResolvedValue({ text: "subscription link expired", userinfo_header: null, fetched_at: Date.now() });

    const cache = await refreshProvider(httpProvider(), { force: true });

    expect(cache.status).toBe("error");
    expect(cache.nodes).toHaveLength(0);
  });

  it("离线源(inline)内容解析为 0 节点:是内容本身的问题,不回退旧节点", async () => {
    mockedReadCache.mockResolvedValue(okCache(30));
    mockedFetch.mockResolvedValue({ text: "garbage", userinfo_header: null, fetched_at: Date.now() });

    const cache = await refreshProvider(fakeProvider({ interval: "never" }), { force: true });

    expect(cache.status).toBe("error");
    expect(cache.nodes).toHaveLength(0);
  });

  it("拉取报错且旧 cache 本来就是 0 节点:写 error 而不是「使用旧缓存」", async () => {
    mockedReadCache.mockResolvedValue({ ...okCache(30, []), status: "error", retry: { failures: 1, last_attempt_at: 0 } });
    mockedFetch.mockRejectedValue(new Error("HTTP 403"));

    const cache = await refreshProvider(httpProvider(), { force: true });

    expect(cache.status).toBe("error");
    expect(cache.retry?.failures).toBe(2);
  });
});

describe("refreshProvider - 失败后退避重试,连续失败转离线", () => {
  const provider = () => fakeProvider({ interval: "24h" });
  const failedCache = (failures: number, minutesAgo: number): ProviderCache => ({
    ...okCache(3000),
    status: "stale",
    error: "HTTP 403",
    retry: { failures, last_attempt_at: Date.now() - minutesAgo * 60_000 },
  });

  it("重试间隔:5 → 10 → 20 分钟,之后回到节点源自己的周期", () => {
    expect([1, 2, 3, 4, 9].map((n) => retryDelayMinutes(n, 1440))).toEqual([5, 10, 20, 1440, 1440]);
    expect(OFFLINE_AFTER_FAILURES).toBe(4);
  });

  it("没到重试时间:scheduler 不重拉,直接沿用旧节点", async () => {
    mockedReadCache.mockResolvedValue(failedCache(1, 3));

    const cache = await refreshProvider(provider());

    expect(mockedFetch).not.toHaveBeenCalled();
    expect(cache.nodes).toHaveLength(1);
  });

  it("到了重试时间:重拉,失败次数累加", async () => {
    mockedReadCache.mockResolvedValue(failedCache(2, 11));
    mockedFetch.mockRejectedValue(new Error("HTTP 403"));

    const cache = await refreshProvider(provider());

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(cache.status).toBe("stale");
    expect(cache.retry?.failures).toBe(3);
  });

  it("已转离线:按刷新周期才再试,不再几分钟一次", async () => {
    mockedReadCache.mockResolvedValue(failedCache(OFFLINE_AFTER_FAILURES, 120));
    await refreshProvider(provider());
    expect(mockedFetch).not.toHaveBeenCalled();

    mockedReadCache.mockResolvedValue(failedCache(OFFLINE_AFTER_FAILURES, 1441));
    await refreshProvider(provider());
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("用户手动刷新(force)不受退避限制", async () => {
    mockedReadCache.mockResolvedValue(failedCache(1, 0));

    await refreshProvider(provider(), { force: true });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it("刷新成功后清掉失败计数", async () => {
    mockedReadCache.mockResolvedValue(failedCache(OFFLINE_AFTER_FAILURES, 0));

    const cache = await refreshProvider(provider(), { force: true });

    expect(cache.status).toBe("ok");
    expect(cache.retry).toBeUndefined();
  });

  it("老版本写下的 stale / error cache 没有 retry 字段:照常重拉一次,补上计数", async () => {
    mockedReadCache.mockResolvedValue({ ...okCache(3000), status: "stale" });
    mockedFetch.mockRejectedValue(new Error("HTTP 403"));

    const cache = await refreshProvider(provider());

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(cache.retry?.failures).toBe(1);
  });
});
