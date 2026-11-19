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
vi.mock("../../src/surge-modules/remote.js", () => ({
  loadRemoteModule: vi.fn(),
}));
vi.mock("../../src/auth/secret.js", () => ({
  getSessionSecret: () => "test-secret-0123456789abcdef",
}));

import { profileRepo, providerRepo, surgeModuleRepo } from "../../src/storage/repos.js";
import { loadRemoteModule } from "../../src/surge-modules/remote.js";
import { moduleAccessToken } from "../../src/surge-modules/links.js";
import { buildNodePool } from "../../src/providers/pool.js";
import { aggregateUserInfo } from "../../src/userinfo/aggregate.js";
import { loadConfig } from "../../src/storage/config-store.js";
import { mountSubRoute } from "../../src/routes/sub.js";

const mockedProfileGet = profileRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedProviderGet = providerRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedBuildNodePool = buildNodePool as unknown as ReturnType<typeof vi.fn>;
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
    node_filter: { rename_rules: [], exclude_types: [], sort_by_region: false },
    chain_rules: [],
    proxy_groups: [],
    rule_modules: [],
    surge_modules: [],
    userinfo: { enabled: true, mode: "sum", expose_per_provider_headers: true },
    managed_config_url: "auto",
    managed_config_interval: 86400,
    managed_config_strict: false,
    ...overrides,
  };
}

function fakeProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: "airport-a",
    name: "Airport A",
    type: "http",
    url: "https://example.com/sub",
    user_agents: [],
    refresh: { interval: "12h" },
    parser_hint: "auto",
    enabled: true,
    tags: [],
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
  it("400 when missing profile/t", async () => {
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

  it("400 for target=clash: Clash 输出已移除", async () => {
    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=clash&t=GOODtoken123");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("仅支持 target=surge（Clash 输出已移除）");
    expect(mockedProfileGet).not.toHaveBeenCalled();
  });

  it("旧的 Clash 订阅路径已删除 → 404", async () => {
    const app = buildApp();
    expect((await app.request("/sub/clash/home?t=GOODtoken123")).status).toBe(404);
    expect((await app.request("/sub/provider/airport-a/clash.yaml?profile=home&t=GOODtoken123")).status).toBe(404);
    expect(mockedProfileGet).not.toHaveBeenCalled();
  });

  it("404 when profile not found", async () => {
    mockedProfileGet.mockResolvedValue(null);
    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=surge&t=GOODtoken123");
    expect(res.status).toBe(404);
  });

  it("401 when token mismatch", async () => {
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });
    const app = buildApp();
    const res = await app.request("/sub?profile=home&target=surge&t=BADtoken");
    expect(res.status).toBe(401);
  });

  it("200 without target(缺省即 surge)with all expected headers", async () => {
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
    const res = await app.request("/sub?profile=home&t=GOODtoken123");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    // 文件名由 profile.name(Home)派生,而不是 profile.id(home);同时带 RFC 5987 UTF-8 form
    expect(res.headers.get("Content-Disposition")).toContain('filename="Home.conf"');
    expect(res.headers.get("Content-Disposition")).toContain("filename*=UTF-8''Home.conf");
    expect(res.headers.get("Profile-Update-Interval")).toBe("24");
    expect(res.headers.get("Subscription-UserInfo")).toContain("upload=1000");
    expect(res.headers.get("X-NodeDeck-Userinfo-airport-a")).toContain("upload=1000");

    const body = await res.text();
    // managed-config 地址格式不变,仍带 target=surge
    expect(body).toMatch(/^#!MANAGED-CONFIG http:\/\/localhost\/sub\?profile=home&target=surge&t=GOODtoken123/);
    expect(body).toContain("🇭🇰 HK-01 = ss,");
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
    const res = await app.request("/sub/surge/home?t=GOODtoken123");
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
    const res = await app.request("/sub?profile=home&target=surge&t=GOODtoken123");
    expect(res.status).toBe(200);
    const cd = res.headers.get("Content-Disposition") ?? "";
    // 中文净化掉之后只剩扩展名,ASCII fallback 回退到 id(home)
    expect(cd).toContain('filename="home.conf"');
    // RFC 5987 form 保留中文(percent-encoded UTF-8)
    expect(cd).toContain(`filename*=UTF-8''${encodeURIComponent("家庭订阅.conf")}`);
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
    expect(cd).not.toMatch(/filename=".*[/*"].*"/);
  });
});

describe("GET /module/:file", () => {
  const mockedModuleGet = surgeModuleRepo.get as unknown as ReturnType<typeof vi.fn>;
  const mockedLoadRemote = loadRemoteModule as unknown as ReturnType<typeof vi.fn>;
  const app = new Hono();
  mountSubRoute(app);

  it("serves a public local module as .sgmodule without any token", async () => {
    mockedModuleGet.mockResolvedValue({
      data: {
        id: "ads",
        name: "去广告",
        source: "local",
        public: true,
        fetch_via: [],
        content_sections: { rule: "DOMAIN,ads.example.com,REJECT" },
      },
    });
    const res = await app.request("/module/ads.sgmodule");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toBe("#!name=去广告\n\n[Rule]\nDOMAIN,ads.example.com,REJECT\n");
    expect(mockedModuleGet).toHaveBeenCalledWith("ads");
  });

  it("passes remote module text through verbatim, 502 when nothing cached", async () => {
    const remote = {
      id: "r",
      name: "R",
      source: "remote",
      public: true,
      url: "https://example.com/r.sgmodule",
      fetch_via: [],
      content_sections: {},
    };
    mockedModuleGet.mockResolvedValue({ data: remote });
    mockedLoadRemote.mockResolvedValueOnce({ status: "ok", text: "#!name=Upstream\n[Rule]\nDOMAIN,a.com,REJECT" });
    const ok = await app.request("/module/r.sgmodule");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("#!name=Upstream\n[Rule]\nDOMAIN,a.com,REJECT");

    mockedLoadRemote.mockResolvedValueOnce({ status: "error", error: "HTTP 404" });
    const bad = await app.request("/module/r.sgmodule");
    expect(bad.status).toBe(502);
    // 不泄露上游地址 / 错误细节
    expect(await bad.text()).toBe("module content unavailable");
  });

  it("404 for unknown module or malformed file name", async () => {
    mockedModuleGet.mockResolvedValue(null);
    expect((await app.request("/module/nope.sgmodule")).status).toBe(404);
    expect((await app.request("/module/ads.conf")).status).toBe(404);
    expect((await app.request("/module/..%2Fx.sgmodule")).status).toBe(404);
  });

  it("private module (default) needs its own ?t= token; wrong / missing / other module's token → 404", async () => {
    mockedModuleGet.mockResolvedValue({
      data: {
        id: "secret-mod",
        name: "含密码",
        source: "local",
        public: false,
        fetch_via: [],
        content_sections: { general: "external-controller-access = pw@0.0.0.0:6170" },
      },
    });
    const token = moduleAccessToken("secret-mod", "test-secret-0123456789abcdef");
    expect(token).toMatch(/^[A-Za-z0-9_-]{22}$/);

    for (const q of ["", "?t=", "?t=wrong", `?t=${moduleAccessToken("other", "test-secret-0123456789abcdef")}`]) {
      const res = await app.request(`/module/secret-mod.sgmodule${q}`);
      expect(res.status).toBe(404);
      expect(await res.text()).toBe("module not found");
    }
    const ok = await app.request(`/module/secret-mod.sgmodule?t=${token}`);
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("external-controller-access");
  });
});
