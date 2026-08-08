import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Profile } from "../../src/schemas/profile.js";
import type { Node } from "../../src/schemas/node.js";
import type { Provider } from "../../src/schemas/provider.js";

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

import { profileRepo, providerRepo, proxyGroupRepo, rulesetRepo } from "../../src/storage/repos.js";
import { buildNodePool } from "../../src/providers/pool.js";
import { loadConfig } from "../../src/storage/config-store.js";
import { profilePreviewRouter } from "../../src/routes/profile-preview.js";

const mockedProfileGet = profileRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedProviderGet = providerRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedGroupGet = proxyGroupRepo.get as unknown as ReturnType<typeof vi.fn>;
const mockedRulesetGet = rulesetRepo.get as unknown as ReturnType<typeof vi.fn>;
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

function fakeNode(name: string, sourceProviderId: string): Node {
  return {
    name,
    type: "ss",
    server: "hk.example.com",
    port: 8388,
    cipher: "aes-128-gcm",
    password: "pwd",
    source_provider_id: sourceProviderId,
    tags: [],
  };
}

function providerEntry(id: string, name: string, tags: string[] = []) {
  return {
    id,
    path: "",
    mtimeMs: 0,
    data: { id, name, enabled: true, tags } as unknown as Provider,
  };
}

function postNodePool(app: Hono, id: string, body: unknown): Promise<Response> {
  return app.request(`/api/profiles/${id}/node-pool-preview`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/profiles/:id/node-pool-preview", () => {
  it("跨机场重名节点 → 预览名带 `【来源】` 前缀,与订阅产物一致", async () => {
    mockedBuildNodePool.mockResolvedValue({
      nodes: [fakeNode("Hong Kong 01", "prov-a"), fakeNode("Hong Kong 01", "prov-b")],
      byProvider: new Map(),
      revalidating: [],
    });
    mockedProviderGet.mockImplementation((pid: string) =>
      Promise.resolve(
        pid === "prov-a"
          ? providerEntry("prov-a", "Aurora", ["主力"])
          : providerEntry("prov-b", "Backup"),
      ),
    );

    const res = await postNodePool(buildApp(), "home", { providers: ["prov-a", "prov-b"] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { nodes: { name: string }[]; count: number };
    expect(json.nodes.map((n) => n.name)).toEqual(["【主力】Hong Kong 01", "【B】Hong Kong 01"]);
    expect(json.count).toBe(2);
  });

  it("rename_rules 参与预览(后端应用,与订阅一致)", async () => {
    mockedBuildNodePool.mockResolvedValue({
      nodes: [fakeNode("Hong Kong 01", "prov-a")],
      byProvider: new Map(),
      revalidating: [],
    });
    mockedProviderGet.mockResolvedValue(providerEntry("prov-a", "Aurora"));

    const res = await postNodePool(buildApp(), "home", {
      providers: ["prov-a"],
      node_filter: {
        rename_rules: [{ pattern: "Hong Kong", replace: "HK" }],
        exclude_types: [],
        sort_by_region: false,
      },
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { nodes: { name: string }[] };
    expect(json.nodes[0].name).toBe("HK 01");
  });

  it("provider 实体缺失时回退 ` #2` 后缀去重,不报错", async () => {
    mockedBuildNodePool.mockResolvedValue({
      nodes: [fakeNode("HK 01", "prov-x"), fakeNode("HK 01", "prov-y")],
      byProvider: new Map(),
      revalidating: [],
    });
    mockedProviderGet.mockResolvedValue(null);

    const res = await postNodePool(buildApp(), "home", { providers: ["prov-x", "prov-y"] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { nodes: { name: string }[] };
    expect(json.nodes.map((n) => n.name)).toEqual(["HK 01", "HK 01 #2"]);
  });

  it("无重名时名字保持原样", async () => {
    mockedBuildNodePool.mockResolvedValue({
      nodes: [fakeNode("HK 01", "prov-a"), fakeNode("JP 01", "prov-a")],
      byProvider: new Map(),
      revalidating: [],
    });
    mockedProviderGet.mockResolvedValue(providerEntry("prov-a", "Aurora", ["主力"]));

    const res = await postNodePool(buildApp(), "home", { providers: ["prov-a"] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { nodes: { name: string }[] };
    expect(json.nodes.map((n) => n.name)).toEqual(["HK 01", "JP 01"]);
  });
});

interface ChainPreviewJson {
  node_count: number;
  rules: {
    index: number;
    enabled: boolean;
    via: string;
    via_status: string;
    matched_count: number;
    effective_count: number;
    sample: string[];
  }[];
  unmatched_count: number;
  conflicts: { node: string; rules: number[] }[];
  chains: { node: string; path: string[]; terminal: string }[];
  groups: { name: string; member_count: number }[];
  nodes: { name: string }[];
  warnings: string[];
}

function groupEntry(id: string, name: string, includeRegex: string) {
  return {
    id,
    path: "",
    mtimeMs: 0,
    data: {
      id,
      name,
      type: "select",
      proxies: [],
      nested_groups: [],
      selector: {
        include_regex: includeRegex,
        include_other_group: [],
        from_providers: [],
        exclude_type: [],
        include_region: [],
      },
    },
  };
}

describe("POST /api/profiles/:id/chain-preview", () => {
  function postChain(id: string, body: unknown): Promise<Response> {
    return buildApp().request(`/api/profiles/${id}/chain-preview`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  it("按策略组圈定节点,回传命中数与出口类型", async () => {
    mockedBuildNodePool.mockResolvedValue({
      nodes: [fakeNode("HK 01", "prov-a"), fakeNode("JP 01", "prov-a"), fakeNode("US 01", "prov-a")],
      byProvider: new Map(),
      revalidating: [],
    });
    mockedProviderGet.mockResolvedValue(providerEntry("prov-a", "Aurora"));
    mockedGroupGet.mockResolvedValue(groupEntry("ai", "AI", "HK|JP"));
    mockedProfileGet.mockResolvedValue({
      id: "home",
      path: "",
      mtimeMs: 0,
      data: fakeProfile(),
    });

    const draft = fakeProfile({
      providers: ["prov-a"],
      proxy_groups: ["ai"],
      chain_rules: [
        {
          enabled: true,
          selector: {
            include_groups: ["AI"],
            include_nodes: [],
            include_type: [],
            include_other_group: [],
            from_providers: [],
            exclude_type: [],
            include_region: [],
          },
          via: "US 01",
          mode: "override",
        },
      ],
    });
    const res = await postChain("home", { profile: draft });
    expect(res.status).toBe(200);
    const json = (await res.json()) as ChainPreviewJson;
    expect(json.node_count).toBe(3);
    expect(json.groups).toEqual([{ name: "AI", member_count: 2 }]);
    expect(json.rules[0].matched_count).toBe(2);
    expect(json.rules[0].effective_count).toBe(2);
    expect(json.rules[0].via_status).toBe("node");
    expect(json.rules[0].sample).toEqual(["HK 01", "JP 01"]);
    expect(json.unmatched_count).toBe(1);
    expect(json.chains.map((c) => c.path)).toEqual([
      ["HK 01", "US 01"],
      ["JP 01", "US 01"],
    ]);
  });

  it("指定节点 + 冲突诊断:后一条被前一条抢走时 effective 为 0", async () => {
    mockedBuildNodePool.mockResolvedValue({
      nodes: [fakeNode("HK 01", "prov-a"), fakeNode("JP 01", "prov-a")],
      byProvider: new Map(),
      revalidating: [],
    });
    mockedProviderGet.mockResolvedValue(providerEntry("prov-a", "Aurora"));
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });

    const emptySelector = {
      include_groups: [],
      include_nodes: [] as string[],
      include_type: [],
      include_other_group: [],
      from_providers: [],
      exclude_type: [],
      include_region: [],
    };
    const draft = fakeProfile({
      providers: ["prov-a"],
      chain_rules: [
        { enabled: true, selector: { ...emptySelector, include_nodes: ["HK 01"] }, via: "JP 01", mode: "override" },
        { enabled: true, selector: { ...emptySelector, include_nodes: ["HK 01"] }, via: "DIRECT", mode: "override" },
      ],
    });
    const res = await postChain("home", { profile: draft });
    const json = (await res.json()) as ChainPreviewJson;
    expect(json.rules[0].effective_count).toBe(1);
    expect(json.rules[1].matched_count).toBe(1);
    expect(json.rules[1].effective_count).toBe(0);
    expect(json.conflicts).toEqual([{ node: "HK 01", rules: [0, 1] }]);
  });

  it("出口指向不存在的名字 → via_status=missing,且 warnings 提示降级", async () => {
    mockedBuildNodePool.mockResolvedValue({
      nodes: [fakeNode("HK 01", "prov-a")],
      byProvider: new Map(),
      revalidating: [],
    });
    mockedProviderGet.mockResolvedValue(providerEntry("prov-a", "Aurora"));
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });

    const draft = fakeProfile({
      providers: ["prov-a"],
      chain_rules: [
        {
          enabled: true,
          selector: {
            include_groups: [],
            include_nodes: [],
            include_type: [],
            include_other_group: [],
            from_providers: [],
            exclude_type: [],
            include_region: [],
          },
          via: "Ghost",
          mode: "override",
        },
      ],
    });
    const res = await postChain("home", { profile: draft });
    const json = (await res.json()) as ChainPreviewJson;
    expect(json.rules[0].via_status).toBe("missing");
    expect(json.warnings.some((w) => w.includes("Chain dangling"))).toBe(true);
    // validateChain 已把悬空的 chain_via 清掉,所以不留残链
    expect(json.chains).toEqual([]);
  });

  it("profile 不存在且无 draft → 404", async () => {
    mockedProfileGet.mockResolvedValue(null);
    const res = await buildApp().request("/api/profiles/missing/chain-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
  });
});

interface FlowPreviewJson {
  entries: { kind: string; label: string; policy: string; policy_kind: string }[];
  groups: {
    name: string;
    type: string;
    members: { name: string; kind: string; origin: string; chain_path?: string[] }[];
    node_total: number;
    notes: { level: string; text: string }[];
  }[];
  node_count: number;
  chain_count: number;
  warnings: string[];
}

describe("POST /api/profiles/:id/flow-preview", () => {
  function postFlow(id: string, body: unknown): Promise<Response> {
    return buildApp().request(`/api/profiles/${id}/flow-preview`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });
  }

  /**
   * 复刻「AI 网站优先走 机场→落地,落地挂了回退机场直连」这套配置:
   *   AI      = fallback, [Landing(点名), JP-Auto(嵌套)]
   *   JP-Auto = smart, selector 捞 JP 节点
   *   chain   : Landing 的前置 = JP-Auto
   * 断言重点是 fallback 的成员**顺序**(顺序即优先级)与链路标注。
   */
  it("fallback 组 → 成员按 点名 → 嵌套 排序,链式成员带出完整链路", async () => {
    mockedBuildNodePool.mockResolvedValue({
      nodes: [fakeNode("Landing", "prov-a"), fakeNode("JP 01", "prov-a"), fakeNode("JP 02", "prov-a")],
      byProvider: new Map(),
      revalidating: [],
    });
    mockedProviderGet.mockResolvedValue(providerEntry("prov-a", "Aurora"));
    mockedGroupGet.mockImplementation((gid: string) =>
      Promise.resolve(
        gid === "ai"
          ? {
              id: "ai",
              path: "",
              mtimeMs: 0,
              data: {
                id: "ai",
                name: "AI",
                type: "fallback",
                proxies: ["Landing"],
                nested_groups: ["JP-Auto"],
                interval: 300,
              },
            }
          : groupEntry("jp", "JP-Auto", "^JP"),
      ),
    );
    mockedRulesetGet.mockResolvedValue({
      id: "ai-list",
      path: "",
      mtimeMs: 0,
      data: {
        id: "ai-list",
        name: "AI 网站",
        type: "remote_url",
        url: "https://example.com/ai.list",
        behavior: "classical",
        format: "yaml",
        clash_format: "rule_provider",
        surge_format: "rule_set",
        update_interval: 86400,
      },
    });
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });

    const draft = fakeProfile({
      providers: ["prov-a"],
      proxy_groups: ["ai", "jp"],
      rule_modules: [{ ref: "ai-list", policy: "AI", enabled: true }, { final: "AI" }],
      chain_rules: [
        {
          enabled: true,
          selector: {
            include_groups: [],
            include_nodes: ["Landing"],
            include_type: [],
            include_other_group: [],
            from_providers: [],
            exclude_type: [],
            include_region: [],
          },
          via: "JP-Auto",
          mode: "override",
        },
      ],
    });

    const res = await postFlow("home", { profile: draft });
    expect(res.status).toBe(200);
    const json = (await res.json()) as FlowPreviewJson;

    expect(json.entries).toEqual([
      { kind: "ruleset", label: "AI 网站", detail: "https://example.com/ai.list", policy: "AI", policy_kind: "group" },
      { kind: "final", label: "FINAL", detail: "兜底", policy: "AI", policy_kind: "group" },
    ]);

    const ai = json.groups.find((g) => g.name === "AI");
    expect(ai?.type).toBe("fallback");
    // 顺序即优先级:落地节点必须排在兜底组前面
    expect(ai?.members).toEqual([
      { name: "Landing", kind: "node", origin: "explicit", chain_path: ["Landing", "JP-Auto"] },
      { name: "JP-Auto", kind: "group", origin: "nested" },
    ]);
    expect(ai?.node_total).toBe(3);
    expect(json.chain_count).toBe(1);
    expect(json.warnings).toEqual([]);
  });

  it("smart 组里塞了嵌套组 → warn 提示 Surge 会静默忽略", async () => {
    mockedBuildNodePool.mockResolvedValue({
      nodes: [fakeNode("JP 01", "prov-a")],
      byProvider: new Map(),
      revalidating: [],
    });
    mockedProviderGet.mockResolvedValue(providerEntry("prov-a", "Aurora"));
    mockedGroupGet.mockImplementation((gid: string) =>
      Promise.resolve(
        gid === "bad"
          ? {
              id: "bad",
              path: "",
              mtimeMs: 0,
              data: {
                id: "bad",
                name: "Bad",
                type: "smart",
                proxies: [],
                nested_groups: ["JP-Auto"],
              },
            }
          : groupEntry("jp", "JP-Auto", "^JP"),
      ),
    );
    mockedProfileGet.mockResolvedValue({ id: "home", path: "", mtimeMs: 0, data: fakeProfile() });

    const res = await postFlow("home", {
      profile: fakeProfile({ providers: ["prov-a"], proxy_groups: ["bad", "jp"] }),
    });
    const json = (await res.json()) as FlowPreviewJson;
    const bad = json.groups.find((g) => g.name === "Bad");
    expect(bad?.notes.some((n) => n.level === "warn" && n.text.includes("静默忽略"))).toBe(true);
  });

  it("profile 不存在且无 draft → 404", async () => {
    mockedProfileGet.mockResolvedValue(null);
    const res = await buildApp().request("/api/profiles/missing/flow-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(404);
  });
});
