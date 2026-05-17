import { afterEach, describe, expect, it, vi } from "vitest";
import { aggregateUserInfo } from "../../src/userinfo/aggregate.js";
import type { Profile } from "../../src/schemas/profile.js";

vi.mock("../../src/storage/repos.js", () => {
  return {
    providerRepo: {
      get: vi.fn(),
    },
  };
});

vi.mock("../../src/providers/cache-store.js", () => {
  return {
    readProviderCache: vi.fn(),
  };
});

import { providerRepo } from "../../src/storage/repos.js";
import { readProviderCache } from "../../src/providers/cache-store.js";

const mockedRepoGet = providerRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedReadCache = readProviderCache as unknown as ReturnType<typeof vi.fn>;

function profile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "p",
    name: "p",
    token: "abcdefgh",
    providers: ["aaa", "bbb"],
    node_filter: { rename_rules: [], exclude_types: [] },
    chain_rules: [],
    proxy_groups: [],
    rule_modules: [],
    surge_modules: [],
    userinfo: { enabled: true, mode: "sum", expose_per_provider_headers: true },
    managed_config_url: "auto",
    managed_config_interval: 86400,
    managed_config_strict: false,
    clash_options: { use_proxy_providers: false, flag: "mihomo", group_style: "flow" },
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("aggregateUserInfo - sum mode", () => {
  it("sums upload/download/total and takes earliest expire across providers", async () => {
    mockedRepoGet.mockImplementation(async (id: string) => ({
      id,
      data: { id, name: id === "aaa" ? "A 机场" : "B 机场" },
      mtimeMs: 0,
      path: "",
    }));
    mockedReadCache.mockImplementation(async (id: string) => {
      if (id === "aaa") {
        return {
          provider_id: "aaa",
          fetched_at: 0,
          status: "ok",
          raw_userinfo_header: "upload=10",
          userinfo: { upload: 100, download: 200, total: 1000, expire: 9999 },
          nodes: [],
        };
      }
      if (id === "bbb") {
        return {
          provider_id: "bbb",
          fetched_at: 0,
          status: "ok",
          raw_userinfo_header: "upload=50",
          userinfo: { upload: 50, download: 75, total: 500, expire: 8888 },
          nodes: [],
        };
      }
      return null;
    });

    const out = await aggregateUserInfo(profile({ userinfo: { mode: "sum", expose_per_provider_headers: true } }));
    expect(out.aggregated).toEqual({
      upload: 150,
      download: 275,
      total: 1500,
      expire: 8888,
    });
    expect(out.perProvider).toHaveLength(2);
    expect(out.perProvider[0].provider_name).toBe("A 机场");
    expect(out.perProvider[0].raw_header).toBe("upload=10");
  });

  it("ignores zero expire when computing earliest", async () => {
    mockedRepoGet.mockImplementation(async (id: string) => ({ id, data: { id, name: id }, mtimeMs: 0, path: "" }));
    mockedReadCache.mockImplementation(async (id: string) => ({
      provider_id: id,
      fetched_at: 0,
      status: "ok" as const,
      userinfo:
        id === "aaa"
          ? { upload: 1, download: 2, total: 100, expire: 0 }
          : { upload: 3, download: 4, total: 200, expire: 5555 },
      nodes: [],
    }));

    const out = await aggregateUserInfo(profile({ userinfo: { mode: "sum", expose_per_provider_headers: true } }));
    expect(out.aggregated?.expire).toBe(5555);
  });

  it("returns null aggregated when no provider has cache", async () => {
    mockedRepoGet.mockImplementation(async (id: string) => ({ id, data: { id, name: id }, mtimeMs: 0, path: "" }));
    mockedReadCache.mockResolvedValue(null);
    const out = await aggregateUserInfo(profile());
    expect(out.aggregated).toBeNull();
    expect(out.perProvider).toHaveLength(2);
    expect(out.perProvider.every((p) => !p.userinfo)).toBe(true);
  });

  it("skips provider whose repo entry is missing", async () => {
    mockedRepoGet.mockImplementation(async (id: string) =>
      id === "aaa" ? { id, data: { id, name: id }, mtimeMs: 0, path: "" } : null,
    );
    mockedReadCache.mockResolvedValue({
      provider_id: "aaa",
      fetched_at: 0,
      status: "ok",
      userinfo: { upload: 1, download: 1, total: 100, expire: 1234 },
      nodes: [],
    });
    const out = await aggregateUserInfo(profile());
    expect(out.perProvider).toHaveLength(1);
    expect(out.perProvider[0].provider_id).toBe("aaa");
  });
});

describe("aggregateUserInfo - primary mode", () => {
  it("returns the primary provider's userinfo only", async () => {
    mockedRepoGet.mockImplementation(async (id: string) => ({ id, data: { id, name: id }, mtimeMs: 0, path: "" }));
    mockedReadCache.mockImplementation(async (id: string) => ({
      provider_id: id,
      fetched_at: 0,
      status: "ok" as const,
      userinfo:
        id === "aaa"
          ? { upload: 100, download: 200, total: 1000, expire: 9999 }
          : { upload: 50, download: 75, total: 500, expire: 8888 },
      nodes: [],
    }));

    const out = await aggregateUserInfo(
      profile({ userinfo: { mode: "primary", primary_provider: "aaa", expose_per_provider_headers: true } }),
    );
    expect(out.aggregated).toEqual({ upload: 100, download: 200, total: 1000, expire: 9999 });
  });

  it("returns null when primary_provider has no cache", async () => {
    mockedRepoGet.mockImplementation(async (id: string) => ({ id, data: { id, name: id }, mtimeMs: 0, path: "" }));
    mockedReadCache.mockResolvedValue(null);
    const out = await aggregateUserInfo(
      profile({ userinfo: { mode: "primary", primary_provider: "aaa", expose_per_provider_headers: true } }),
    );
    expect(out.aggregated).toBeNull();
  });

  it("returns null when primary_provider is not in providers list", async () => {
    mockedRepoGet.mockImplementation(async (id: string) => ({ id, data: { id, name: id }, mtimeMs: 0, path: "" }));
    mockedReadCache.mockImplementation(async (id: string) => ({
      provider_id: id,
      fetched_at: 0,
      status: "ok" as const,
      userinfo: { upload: 1, download: 1, total: 100, expire: 1000 },
      nodes: [],
    }));
    const out = await aggregateUserInfo(
      profile({ userinfo: { mode: "primary", primary_provider: "ccc", expose_per_provider_headers: true } }),
    );
    expect(out.aggregated).toBeNull();
  });
});
