import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Profile } from "../../src/schemas/profile.js";
import type { Provider } from "../../src/schemas/provider.js";
import type { Node } from "../../src/schemas/node.js";

// 所有 storage / userinfo / config 的依赖都 mock 掉,避免触碰真实文件系统。
vi.mock("../../src/storage/repos.js", () => ({
  profileRepo: { get: vi.fn() },
  providerRepo: { get: vi.fn() },
  // resolveProfile 用 list() 拿系统中所有 group 名给 validateGroupRefs 做"组未引入"诊断
  proxyGroupRepo: { get: vi.fn(), list: vi.fn().mockResolvedValue([]) },
  rulesetRepo: { get: vi.fn() },
  generalPresetRepo: { get: vi.fn() },
  surgeModuleRepo: { get: vi.fn() },
}));
vi.mock("../../src/providers/pool.js", () => ({
  buildNodePool: vi.fn(),
}));
vi.mock("../../src/providers/load.js", () => ({
  loadProviderNodes: vi.fn(),
}));
vi.mock("../../src/userinfo/aggregate.js", () => ({
  aggregateUserInfo: vi.fn(),
}));
vi.mock("../../src/storage/config-store.js", () => ({
  loadConfig: vi.fn(),
}));

import { profileRepo, providerRepo, proxyGroupRepo, rulesetRepo } from "../../src/storage/repos.js";
import { buildNodePool } from "../../src/providers/pool.js";
import { loadProviderNodes } from "../../src/providers/load.js";
import { aggregateUserInfo } from "../../src/userinfo/aggregate.js";
import { loadConfig } from "../../src/storage/config-store.js";
import { mountSubRoute } from "../../src/routes/sub.js";

const mockedProfileGet = profileRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedProviderGet = providerRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedGroupGet = proxyGroupRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedRulesetGet = rulesetRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedBuildNodePool = buildNodePool as unknown as ReturnType<typeof vi.fn>;
const mockedLoadProviderNodes = loadProviderNodes as unknown as ReturnType<typeof vi.fn>;
const mockedAggregate = aggregateUserInfo as unknown as ReturnType<typeof vi.fn>;
const mockedLoadConfig = loadConfig as unknown as ReturnType<typeof vi.fn>;

function buildApp(): Hono {
  const app = new Hono();
  mountSubRoute(app);
  return app;
}

function fakeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "home",
    name: "Home",
    token: "GOODtoken123",
    providers: ["airport-a"],
    include_manual_nodes: false,
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

function fakeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "airport-a",
    name: "Airport A",
    type: "http",
    url: "https://example.com/sub",
    user_agent: "Surge/2400",
    refresh: { interval: "12h" },
    parser_hint: "auto",
    enabled: true,
    tags: [],
    clash_proxy_provider: {
      enabled: false,
      health_check_url: "http://www.gstatic.com/generate_204",
      health_check_interval: 300,
    },
    ...overrides,
  };
}

const sampleNode: Node = {
  name: "🇭🇰 HK-01",
  type: "ss",
  server: "hk.example.com",
  port: 8388,
  cipher: "aes-128-gcm",
  password: "pwd",
  source_provider_id: "airport-a",
  tags: [],
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("/sub route", () => {
  it("400 when missing profile/target/t", async () => {
    const app = buildApp();
    const res = await app.request("/sub");
    expect(res.status).toBe(400);
    const text = await res.text();
    expect(text).toContain("missing query parameters");
  });

  it("400 when target invalid", async () => {
    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=quanx&t=x");
    expect(res.status).toBe(400);
  });

  it("404 when profile not found", async () => {
    mockedProfileGet.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=clash&t=GOODtoken123");
    expect(res.status).toBe(404);
  });

  it("401 when token mismatch", async () => {
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });
    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=clash&t=BADtoken");
    expect(res.status).toBe(401);
  });

  it("200 clash output with all expected headers", async () => {
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });
    mockedProviderGet.mockResolvedValue({ id: "airport-a", path: "", mtimeMs: 0, data: fakeProvider() });
    mockedBuildNodePool.mockResolvedValue({ nodes: [sampleNode], byProvider: new Map() });
    mockedAggregate.mockResolvedValue({
      aggregated: { upload: 1000, download: 2000, total: 10000, expire: 99999 },
      perProvider: [
        { provider_id: "airport-a", provider_name: "Airport A", raw_header: "upload=1000; download=2000; total=10000; expire=99999" },
      ],
    });
    mockedLoadConfig.mockResolvedValue({});

    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=clash&t=GOODtoken123");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/yaml");
    expect(res.headers.get("Content-Disposition")).toContain('filename="home.yaml"');
    expect(res.headers.get("Profile-Update-Interval")).toBe("24");
    expect(res.headers.get("Subscription-UserInfo")).toContain("upload=1000");
    expect(res.headers.get("X-MConvert-Userinfo-airport-a")).toContain("upload=1000");

    const body = await res.text();
    expect(body).toContain("# Generated by MConvert");
    expect(body).toContain("# !flag: mihomo");
    expect(body).toContain("🇭🇰 HK-01");
  });

  it("userinfo.enabled=false 时不发 Subscription-UserInfo / X-MConvert-Userinfo-* 响应头,且不调用聚合", async () => {
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile({
        userinfo: { enabled: false, mode: "sum", expose_per_provider_headers: true },
      }),
    });
    mockedProviderGet.mockResolvedValue({ id: "airport-a", path: "", mtimeMs: 0, data: fakeProvider() });
    mockedBuildNodePool.mockResolvedValue({ nodes: [sampleNode], byProvider: new Map() });
    mockedLoadConfig.mockResolvedValue({});

    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=clash&t=GOODtoken123");
    expect(res.status).toBe(200);
    expect(res.headers.get("Subscription-UserInfo")).toBeNull();
    expect(res.headers.get("X-MConvert-Userinfo-airport-a")).toBeNull();
    // 关闭时根本不应进入聚合分支(省去 cache 读取)
    expect(mockedAggregate).not.toHaveBeenCalled();
  });

  it("200 surge output also has Profile-Update-Interval and managed-config", async () => {
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });
    mockedProviderGet.mockResolvedValue({ id: "airport-a", path: "", mtimeMs: 0, data: fakeProvider() });
    mockedBuildNodePool.mockResolvedValue({ nodes: [sampleNode], byProvider: new Map() });
    mockedAggregate.mockResolvedValue({ aggregated: null, perProvider: [] });
    mockedLoadConfig.mockResolvedValue({ public_base_url: "https://sub.example.com" });

    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=surge&t=GOODtoken123");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    expect(res.headers.get("Content-Disposition")).toContain('filename="home.conf"');
    expect(res.headers.get("Profile-Update-Interval")).toBe("24");

    const body = await res.text();
    expect(body).toMatch(/^#!MANAGED-CONFIG https:\/\/sub\.example\.com\/sub\?profile=home&target=surge&t=GOODtoken123/);
    expect(body).toContain("[Proxy]");
    expect(body).toContain("🇭🇰 HK-01 = ss,");
  });
});

describe("/sub/provider/:id/clash.yaml route", () => {
  it("400 when missing profile/t", async () => {
    const app = buildApp();
    const res = await app.request("/sub/provider/airport-a/clash.yaml");
    expect(res.status).toBe(400);
  });

  it("404 when profile missing", async () => {
    mockedProfileGet.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.request("/sub/provider/airport-a/clash.yaml?profile=home&t=GOODtoken123");
    expect(res.status).toBe(404);
  });

  it("401 when token mismatch", async () => {
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });
    const app = buildApp();
    const res = await app.request("/sub/provider/airport-a/clash.yaml?profile=home&t=BAD");
    expect(res.status).toBe(401);
  });

  it("404 when clash_proxy_provider not enabled", async () => {
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });
    mockedProviderGet.mockResolvedValue({ id: "airport-a", path: "", mtimeMs: 0, data: fakeProvider() });
    const app = buildApp();
    const res = await app.request("/sub/provider/airport-a/clash.yaml?profile=home&t=GOODtoken123");
    expect(res.status).toBe(404);
  });

  it("200 with proxies-only yaml when clash_proxy_provider enabled", async () => {
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });
    mockedProviderGet.mockResolvedValue({
      id: "airport-a",
      path: "",
      mtimeMs: 0,
      data: fakeProvider({
        clash_proxy_provider: {
          enabled: true,
          health_check_url: "http://cp.cloudflare.com/generate_204",
          health_check_interval: 300,
        },
      }),
    });
    mockedLoadProviderNodes.mockResolvedValue([sampleNode]);

    const app = buildApp();
    const res = await app.request("/sub/provider/airport-a/clash.yaml?profile=home&t=GOODtoken123");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/yaml");
    expect(res.headers.get("Content-Disposition")).toContain('filename="airport-a.yaml"');
    const body = await res.text();
    expect(body).toContain("proxies:");
    expect(body).toContain("🇭🇰 HK-01");
    // 不应包含 proxy-groups / rules
    expect(body).not.toContain("proxy-groups:");
    expect(body).not.toContain("rules:");
  });

  // 未引用的内容确保 mock 是齐全的
  void mockedGroupGet;
  void mockedRulesetGet;
});
