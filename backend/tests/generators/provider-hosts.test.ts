import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "../../src/schemas/profile.js";

// resolveProfile 的 IO 依赖全部 mock,只验证"上游自动解析的 hosts 按 emit_hosts 并入"。
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
import { readProviderCache } from "../../src/providers/cache-store.js";
import { providerSchema } from "../../src/schemas/provider.js";

const mockedProviderGet = providerRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedReadCache = readProviderCache as unknown as ReturnType<typeof vi.fn>;

function fakeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "home",
    name: "Home",
    token: "GOODtoken123",
    providers: ["p1"],
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
    ...overrides,
  } as Profile;
}

function provider(emit_hosts: boolean) {
  return {
    id: "p1",
    path: "",
    mtimeMs: 0,
    data: providerSchema.parse({
      id: "p1",
      name: "Kuromis",
      type: "http",
      url: "https://resourcemap.lol/sub?token=x&type=surge",
      emit_hosts,
    }),
  };
}

const EXTRACTED = {
  "*.ovalyraa.com": [
    "server:https://hydrogen1693.com:44443/dns-query/x",
    "server:https://subprime7404.com:44443/dns-query/x",
  ],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveProfile - 上游自动解析的 hosts 随 emit_hosts 带出", () => {
  it("emit_hosts=true 时,cache.extracted_hosts 并入 resolved.hosts", async () => {
    mockedProviderGet.mockResolvedValue(provider(true));
    mockedReadCache.mockResolvedValue({
      provider_id: "p1",
      fetched_at: Date.now(),
      status: "ok",
      nodes: [],
      extracted_hosts: EXTRACTED,
    });

    const resolved = await resolveProfile(fakeProfile());

    expect(resolved.hosts).toBeDefined();
    expect(resolved.hosts?.["*.ovalyraa.com"]).toEqual(EXTRACTED["*.ovalyraa.com"]);
  });

  it("emit_hosts=false 时,自动解析的 hosts 不带出", async () => {
    mockedProviderGet.mockResolvedValue(provider(false));
    mockedReadCache.mockResolvedValue({
      provider_id: "p1",
      fetched_at: Date.now(),
      status: "ok",
      nodes: [],
      extracted_hosts: EXTRACTED,
    });

    const resolved = await resolveProfile(fakeProfile());

    expect(resolved.hosts).toBeUndefined();
  });
});
