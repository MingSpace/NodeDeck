import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../../src/schemas/profile.js";

// resolveProfile 的 IO 依赖全部 mock,只验证配额排除:谁进节点池、warnings、全排除兜底。
vi.mock("../../src/storage/repos.js", () => ({
  providerRepo: { get: vi.fn(), list: vi.fn().mockResolvedValue([]) },
  proxyGroupRepo: { get: vi.fn(), list: vi.fn().mockResolvedValue([]) },
  rulesetRepo: { get: vi.fn() },
  generalPresetRepo: { get: vi.fn() },
  surgeModuleRepo: { get: vi.fn() },
}));
vi.mock("../../src/providers/pool.js", () => ({
  buildNodePool: vi.fn().mockResolvedValue({ nodes: [], byProvider: new Map() }),
}));
vi.mock("../../src/providers/cache-store.js", () => ({
  readProviderCache: vi.fn(),
}));

import { resolveProfile } from "../../src/generators/profile-resolver.js";
import { providerRepo } from "../../src/storage/repos.js";
import { buildNodePool } from "../../src/providers/pool.js";
import { readProviderCache } from "../../src/providers/cache-store.js";
import { providerSchema } from "../../src/schemas/provider.js";

const mockedProviderGet = providerRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedReadCache = readProviderCache as unknown as ReturnType<typeof vi.fn>;
const mockedPool = buildNodePool as unknown as ReturnType<typeof vi.fn>;

const GB = 1024 ** 3;

function fakeProfile(providers: string[]): Profile {
  return {
    id: "home",
    name: "Home",
    token: "GOODtoken123",
    providers,
    node_filter: { rename_rules: [], exclude_types: [], sort_by_region: false },
    chain_rules: [],
    proxy_groups: [],
    rule_modules: [],
    surge_modules: [],
    userinfo: { enabled: false, mode: "sum", expose_per_provider_headers: true },
    managed_config_url: "auto",
    managed_config_interval: 86400,
    managed_config_strict: false,
    clash_options: { use_proxy_providers: false, flag: "mihomo", group_style: "flow" },
  } as Profile;
}

const PROVIDERS = {
  flower: providerSchema.parse({
    id: "flower",
    name: "FlowerCloud",
    type: "inline",
    content: "x",
    quota: { reset_day: 2, exhausted_until: "2099-11-02" },
  }),
  kuro: providerSchema.parse({ id: "kuro", name: "Kuromis", type: "http", url: "https://sub.example.com/k" }),
};

function setup(caches: Record<string, unknown> = {}) {
  mockedProviderGet.mockImplementation((id: keyof typeof PROVIDERS) =>
    Promise.resolve(PROVIDERS[id] ? { id, path: "", mtimeMs: 0, data: PROVIDERS[id] } : null),
  );
  mockedReadCache.mockImplementation((id: string) => Promise.resolve(caches[id] ?? null));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveProfile - 流量用完 / 到期的节点源临时排除", () => {
  it("手动标记用完的离线源不进节点池,但仍留在 providers 里(前缀消歧不变)", async () => {
    setup();
    const resolved = await resolveProfile(fakeProfile(["flower", "kuro"]));

    expect(mockedPool).toHaveBeenCalledWith(expect.objectContaining({ providerIds: ["kuro"] }));
    expect(resolved.excludedProviderIds).toEqual(new Set(["flower"]));
    expect(resolved.providers.map((p) => p.id)).toEqual(["flower", "kuro"]);
    expect(resolved.warnings).toContain(
      "节点源「FlowerCloud」流量已用完(手动标记),已从订阅中临时排除,预计 2099-11-02 恢复",
    );
  });

  it("在线源按 cache 里的上游 userinfo 自动判定", async () => {
    setup({
      kuro: {
        provider_id: "kuro",
        fetched_at: Date.now(),
        status: "ok",
        nodes: [],
        userinfo: { upload: 0, download: 200 * GB, total: 200 * GB, expire: 0 },
      },
    });
    const resolved = await resolveProfile(fakeProfile(["kuro", "flower"]));

    // 两个都被排除 → 兜底不排除
    expect(resolved.excludedProviderIds.size).toBe(0);
    expect(mockedPool).toHaveBeenCalledWith(expect.objectContaining({ providerIds: ["kuro", "flower"] }));
    expect(resolved.warnings).toContain("所有节点源都流量用完或已到期,本次不做排除,照常输出全部节点");
  });

  it("没有配额问题时照常全部进池,不产生 warning", async () => {
    setup();
    const resolved = await resolveProfile(fakeProfile(["kuro"]));

    expect(mockedPool).toHaveBeenCalledWith(expect.objectContaining({ providerIds: ["kuro"] }));
    expect(resolved.excludedProviderIds.size).toBe(0);
    expect(resolved.warnings).toEqual([]);
  });
});
