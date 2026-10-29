import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Profile } from "../../src/schemas/profile.js";
import type { Node } from "../../src/schemas/node.js";

vi.mock("../../src/storage/repos.js", () => ({
  profileRepo: { list: vi.fn() },
  providerRepo: { list: vi.fn() },
}));
vi.mock("../../src/providers/pool.js", () => ({
  listProvidersWithCache: vi.fn(),
  buildNodePool: vi.fn(),
}));
vi.mock("../../src/providers/cache-store.js", () => ({
  readProviderCache: vi.fn(),
}));
vi.mock("../../src/generators/profile-resolver.js", () => ({
  resolveProfile: vi.fn(),
}));

import { profileRepo } from "../../src/storage/repos.js";
import { resolveProfile } from "../../src/generators/profile-resolver.js";
import { dashboardRouter } from "../../src/routes/dashboard.js";

const mockedProfileList = profileRepo.list as unknown as ReturnType<typeof vi.fn>;
const mockedResolve = resolveProfile as unknown as ReturnType<typeof vi.fn>;

function fakeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "home",
    name: "Home",
    token: "your-token-here",
    providers: [],
    node_filter: { rename_rules: [], exclude_types: [], sort_by_region: false, source_prefix: "conflict" },
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

function ssNode(name: string): Node {
  return {
    name,
    type: "ss",
    server: "ss.example.com",
    port: 8388,
    cipher: "aes-128-gcm",
    password: "placeholder",
    tags: [],
  } as Node;
}

function resolved(nodes: Node[], warnings: string[]) {
  return {
    nodes,
    providers: [],
    groups: [],
    allKnownGroupNames: new Set<string>(),
    rules: [],
    surgeModules: [],
    warnings,
    revalidating: [],
  };
}

function buildApp(): Hono {
  const app = new Hono();
  app.route("/api/dashboard", dashboardRouter);
  return app;
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/dashboard/profiles", () => {
  it("节点数按 node_filter 过滤后计,两端 warnings 去重合并", async () => {
    mockedProfileList.mockResolvedValue([
      { id: "home", path: "", mtimeMs: 0, data: fakeProfile({ node_filter: { rename_rules: [], exclude_types: [], sort_by_region: false, source_prefix: "conflict", exclude_regex: "HK" } }) },
    ]);
    mockedResolve.mockResolvedValue(
      resolved([ssNode("JP 01"), ssNode("HK 01"), ssNode("US 01")], ['proxy_group "gone" not found']),
    );

    const res = await buildApp().request("/api/dashboard/profiles");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; node_count: number; warnings: string[] }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe("home");
    expect(body.items[0].node_count).toBe(2);
    // resolver 的 warning 两端各带一份,合并后只剩一条
    expect(body.items[0].warnings.filter((w) => w.includes('"gone"'))).toHaveLength(1);
  });

  it("单个 Profile 生成抛错时降级成警告,不影响其它 Profile", async () => {
    mockedProfileList.mockResolvedValue([
      { id: "bad", path: "", mtimeMs: 0, data: fakeProfile({ id: "bad" }) },
      { id: "good", path: "", mtimeMs: 0, data: fakeProfile({ id: "good" }) },
    ]);
    mockedResolve.mockImplementation((p: Profile) =>
      p.id === "bad" ? Promise.reject(new Error("boom")) : Promise.resolve(resolved([ssNode("JP 01")], [])),
    );

    const res = await buildApp().request("/api/dashboard/profiles");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { id: string; node_count: number; warnings: string[] }[] };
    const bad = body.items.find((i) => i.id === "bad");
    const good = body.items.find((i) => i.id === "good");
    expect(bad?.warnings).toEqual(["生成失败: boom"]);
    expect(good).toMatchObject({ node_count: 1, warnings: [] });
  });
});
