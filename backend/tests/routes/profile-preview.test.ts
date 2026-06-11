import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Profile } from "../../src/schemas/profile.js";

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
vi.mock("../../src/storage/config-store.js", () => ({
  loadConfig: vi.fn(),
}));

import { profileRepo } from "../../src/storage/repos.js";
import { buildNodePool } from "../../src/providers/pool.js";
import { loadConfig } from "../../src/storage/config-store.js";
import { profilePreviewRouter } from "../../src/routes/profile-preview.js";

const mockedProfileGet = profileRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedBuildNodePool = buildNodePool as unknown as ReturnType<typeof vi.fn>;
const mockedLoadConfig = loadConfig as unknown as ReturnType<typeof vi.fn>;

function buildApp(): Hono {
  const app = new Hono();
  app.route("/api/profiles", profilePreviewRouter);
  return app;
}

function fakeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "home",
    name: "Home",
    token: "GOODtoken123",
    providers: [],
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
  };
}

function postPreview(app: Hono, id: string, body: unknown): Promise<Response> {
  return app.request(`/api/profiles/${id}/preview`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/profiles/:id/preview", () => {
  it("合法 draft → 200,内容来自 draft 而非磁盘版(端到端可观测字段验证)", async () => {
    // 磁盘版 flag=mihomo,draft 显式改为 stash;generator 据此输出 `# !flag: stash` 注释,
    // 这是 profile 字段直接进入 generator 输出的可观测点,比断言"没有警告"更精确。
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile({
        clash_options: { use_proxy_providers: false, flag: "mihomo", group_style: "flow" },
      }),
    });
    mockedBuildNodePool.mockResolvedValue({ nodes: [], byProvider: new Map() });
    mockedLoadConfig.mockResolvedValue({});

    const draft = fakeProfile({
      clash_options: { use_proxy_providers: false, flag: "stash", group_style: "flow" },
    });
    const res = await postPreview(buildApp(), "home", { profile: draft, target: "clash" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { target: string; text: string; warnings: string[]; node_count: number };
    expect(json.target).toBe("clash");
    expect(json.warnings).toEqual([]);
    expect(json.text).toContain("# Profile: home");
    // 关键正向断言:输出里出现 draft 的 flag 而非磁盘版的
    expect(json.text).toContain("# !flag: stash");
    expect(json.text).not.toContain("# !flag: mihomo");
  });

  it("draft 缺必填字段 (name 空串) → best-effort 回退磁盘版,warnings 含字段名", async () => {
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile({ name: "Saved Name" }),
    });
    mockedBuildNodePool.mockResolvedValue({ nodes: [], byProvider: new Map() });
    mockedLoadConfig.mockResolvedValue({});

    // partial draft only — schema 校验失败,但 merged 后能走通(磁盘版兜底缺失字段)
    const partialDraft = { name: "" };
    const res = await postPreview(buildApp(), "home", { profile: partialDraft, target: "clash" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { warnings: string[]; text: string };
    expect(json.warnings.length).toBeGreaterThan(0);
    expect(json.warnings.some((w) => w.includes("name"))).toBe(true);
  });

  it("draft 缺到无法 merge → 回退到磁盘版且 warnings 标注", async () => {
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile({ name: "Saved Name" }),
    });
    mockedBuildNodePool.mockResolvedValue({ nodes: [], byProvider: new Map() });
    mockedLoadConfig.mockResolvedValue({});

    // 故意给个会让合并后仍然非法的 draft(token 类型错误)
    const brokenDraft = { token: 123 };
    const res = await postPreview(buildApp(), "home", { profile: brokenDraft, target: "clash" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { warnings: string[] };
    expect(json.warnings.some((w) => w.includes("已回退到上次保存的版本"))).toBe(true);
  });

  it("不传 body → 200,等价于读磁盘版", async () => {
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile({ name: "Saved Name" }),
    });
    mockedBuildNodePool.mockResolvedValue({ nodes: [], byProvider: new Map() });
    mockedLoadConfig.mockResolvedValue({});

    const res = await buildApp().request("/api/profiles/home/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { warnings: string[]; text: string };
    expect(json.warnings).toEqual([]);
    expect(json.text).toContain("# Profile: home");
  });

  it("profile id 不存在且无 body → 404", async () => {
    mockedProfileGet.mockResolvedValue(null);
    const res = await buildApp().request("/api/profiles/missing/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
  });

  it("profile id 不存在但传了合法 draft → 200,id 取 path 参数", async () => {
    mockedProfileGet.mockResolvedValue(null);
    mockedBuildNodePool.mockResolvedValue({ nodes: [], byProvider: new Map() });
    mockedLoadConfig.mockResolvedValue({});

    const draft = fakeProfile({ id: "home" });
    const res = await postPreview(buildApp(), "home", { profile: draft, target: "clash" });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { warnings: string[]; text: string };
    expect(json.warnings).toEqual([]);
    expect(json.text).toContain("# Profile: home");
  });

  it("target=surge → 200,生成 .conf 格式", async () => {
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile(),
    });
    mockedBuildNodePool.mockResolvedValue({ nodes: [], byProvider: new Map() });
    mockedLoadConfig.mockResolvedValue({});

    const res = await postPreview(buildApp(), "home", {
      profile: fakeProfile(),
      target: "surge",
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { target: string; text: string };
    expect(json.target).toBe("surge");
    expect(json.text).toContain("# Profile: home");
  });

  it("target 通过 query 传也能识别(向后兼容)", async () => {
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile(),
    });
    mockedBuildNodePool.mockResolvedValue({ nodes: [], byProvider: new Map() });
    mockedLoadConfig.mockResolvedValue({});

    const res = await buildApp().request("/api/profiles/home/preview?target=surge", {
      method: "POST",
      body: JSON.stringify({ profile: fakeProfile() }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { target: string };
    expect(json.target).toBe("surge");
  });

  it("非法 target → 400", async () => {
    const res = await postPreview(buildApp(), "home", {
      profile: fakeProfile(),
      target: "quanx",
    });
    expect(res.status).toBe(400);
  });
});
