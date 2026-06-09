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
    // 文件名由 profile.name(Home)派生,而不是 profile.id(home);同时带 RFC 5987 UTF-8 form
    expect(res.headers.get("Content-Disposition")).toContain('filename="Home.yaml"');
    expect(res.headers.get("Content-Disposition")).toContain("filename*=UTF-8''Home.yaml");
    expect(res.headers.get("Profile-Update-Interval")).toBe("24");
    expect(res.headers.get("Subscription-UserInfo")).toContain("upload=1000");
    expect(res.headers.get("X-NodeDeck-Userinfo-airport-a")).toContain("upload=1000");

    const body = await res.text();
    expect(body).toContain("# Generated by NodeDeck");
    expect(body).toContain("# !flag: mihomo");
    expect(body).toContain("🇭🇰 HK-01");
  });

  it("userinfo.enabled=false 时不发 Subscription-UserInfo / X-NodeDeck-Userinfo-* 响应头,且不调用聚合", async () => {
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
    expect(res.headers.get("X-NodeDeck-Userinfo-airport-a")).toBeNull();
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
    expect(res.headers.get("Content-Disposition")).toContain('filename="Home.conf"');
    expect(res.headers.get("Content-Disposition")).toContain("filename*=UTF-8''Home.conf");
    expect(res.headers.get("Profile-Update-Interval")).toBe("24");

    const body = await res.text();
    expect(body).toMatch(/^#!MANAGED-CONFIG https:\/\/sub\.example\.com\/sub\?profile=home&target=surge&t=GOODtoken123/);
    expect(body).toContain("[Proxy]");
    expect(body).toContain("🇭🇰 HK-01 = ss,");
  });

  it("文件名:中文 name 时 ASCII fallback 回退到 id,filename* 走 percent-encoded UTF-8", async () => {
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile({ name: "家庭订阅" }),
    });
    mockedProviderGet.mockResolvedValue({ id: "airport-a", path: "", mtimeMs: 0, data: fakeProvider() });
    mockedBuildNodePool.mockResolvedValue({ nodes: [sampleNode], byProvider: new Map() });
    mockedAggregate.mockResolvedValue({ aggregated: null, perProvider: [] });
    mockedLoadConfig.mockResolvedValue({});

    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=clash&t=GOODtoken123");
    expect(res.status).toBe(200);
    const cd = res.headers.get("Content-Disposition") ?? "";
    // 中文净化掉之后只剩扩展名,ASCII fallback 回退到 id(home)
    expect(cd).toContain('filename="home.yaml"');
    // RFC 5987 form 保留中文(percent-encoded UTF-8)
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent("家庭订阅.yaml")}`);
  });

  it("文件名:name 含路径分隔符 / 通配符等非法字符时,统一替换为下划线", async () => {
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile({ name: 'Home / Backup *bak"v2"' }),
    });
    mockedProviderGet.mockResolvedValue({ id: "airport-a", path: "", mtimeMs: 0, data: fakeProvider() });
    mockedBuildNodePool.mockResolvedValue({ nodes: [sampleNode], byProvider: new Map() });
    mockedAggregate.mockResolvedValue({ aggregated: null, perProvider: [] });
    mockedLoadConfig.mockResolvedValue({});

    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=surge&t=GOODtoken123");
    expect(res.status).toBe(200);
    const cd = res.headers.get("Content-Disposition") ?? "";
    // 三类非法字符(/ * ")都应该被替换成 _,且不出现在 ASCII filename 里
    expect(cd).toContain('filename="Home _ Backup _bak_v2_.conf"');
    expect(cd).not.toMatch(/filename=".*[\/*"].*"/);
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
    mockedLoadProviderNodes.mockResolvedValue({ nodes: [sampleNode], revalidating: false });

    const app = buildApp();
    const res = await app.request("/sub/provider/airport-a/clash.yaml?profile=home&t=GOODtoken123");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/yaml");
    // 文件名由 provider.name(Airport A)派生;空格在 ASCII fallback 中合法(用双引号包裹),
    // 在 RFC 5987 form 中编码为 %20
    expect(res.headers.get("Content-Disposition")).toContain('filename="Airport A.yaml"');
    expect(res.headers.get("Content-Disposition")).toContain("filename*=UTF-8''Airport%20A.yaml");
    const body = await res.text();
    expect(body).toContain("proxies:");
    expect(body).toContain("🇭🇰 HK-01");
    // 不应包含 proxy-groups / rules
    expect(body).not.toContain("proxy-groups:");
    expect(body).not.toContain("rules:");
  });

  it("404 when providerId not in profile.providers (即使该 provider 启用了 clash_proxy_provider)", async () => {
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile({ providers: ["other-airport"] }),
    });
    const app = buildApp();
    const res = await app.request("/sub/provider/airport-a/clash.yaml?profile=home&t=GOODtoken123");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("not part of this profile");
    // 不应进入到 providerRepo.get / loadProviderNodes — 早期返回省了一次磁盘读
    expect(mockedGroupGet).not.toHaveBeenCalled();
    expect(mockedRulesetGet).not.toHaveBeenCalled();
    expect(mockedLoadProviderNodes).not.toHaveBeenCalled();
  });

  it("404 when providerRepo entry missing", async () => {
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });
    mockedProviderGet.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.request("/sub/provider/airport-a/clash.yaml?profile=home&t=GOODtoken123");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("provider not found");
  });

  it("404 when provider.enabled === false", async () => {
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });
    mockedProviderGet.mockResolvedValue({
      id: "airport-a",
      path: "",
      mtimeMs: 0,
      data: fakeProvider({ enabled: false }),
    });
    const app = buildApp();
    const res = await app.request("/sub/provider/airport-a/clash.yaml?profile=home&t=GOODtoken123");
    expect(res.status).toBe(404);
    const text = await res.text();
    expect(text).toContain("provider disabled");
  });
});
