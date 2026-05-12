import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

// Mock storage layer so the test runs without touching disk.
vi.mock("../../src/storage/repos.js", () => ({
  rulesetRepo: { list: vi.fn(), save: vi.fn() },
  proxyGroupRepo: { list: vi.fn(), save: vi.fn() },
  generalPresetRepo: { list: vi.fn(), save: vi.fn() },
  surgeModuleRepo: { list: vi.fn(), save: vi.fn() },
  providerRepo: { list: vi.fn(), save: vi.fn() },
  profileRepo: { list: vi.fn(), save: vi.fn() },
}));
vi.mock("../../src/storage/manual-nodes.js", () => ({
  readManualNodes: vi.fn(async () => ({ nodes: [] })),
  writeManualNodes: vi.fn(),
}));
vi.mock("../../src/providers/pool.js", () => ({
  buildNodePool: vi.fn(async () => ({ nodes: [] })),
}));

// 用 deterministic 计数器代替随机 nanoid,便于断言 id 撞库 / 兜底重试逻辑。
// 实际生产路径仍然走 6 位 nanoid;这里只是把"随机"换成"可预测序列"。
let __idCounter = 0;
vi.mock("../../src/import/id.js", () => ({
  generateImportedId: vi.fn((slug?: string | null) => {
    const cleanSlug = (slug ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32);
    __idCounter++;
    const suffix = `m${__idCounter.toString(36).padStart(5, "0")}`;
    return cleanSlug ? `imported-${cleanSlug}-${suffix}` : `imported-${suffix}`;
  }),
  shortId: vi.fn(() => "m00000"),
}));

import {
  rulesetRepo,
  proxyGroupRepo,
  generalPresetRepo,
  surgeModuleRepo,
} from "../../src/storage/repos.js";
import { writeManualNodes } from "../../src/storage/manual-nodes.js";
import { importRouter } from "../../src/routes/import.js";

const mocked = {
  rulesetList: rulesetRepo.list as unknown as ReturnType<typeof vi.fn>,
  rulesetSave: rulesetRepo.save as unknown as ReturnType<typeof vi.fn>,
  groupList: proxyGroupRepo.list as unknown as ReturnType<typeof vi.fn>,
  groupSave: proxyGroupRepo.save as unknown as ReturnType<typeof vi.fn>,
  generalList: generalPresetRepo.list as unknown as ReturnType<typeof vi.fn>,
  generalSave: generalPresetRepo.save as unknown as ReturnType<typeof vi.fn>,
  moduleList: surgeModuleRepo.list as unknown as ReturnType<typeof vi.fn>,
  moduleSave: surgeModuleRepo.save as unknown as ReturnType<typeof vi.fn>,
  writeManualNodes: writeManualNodes as unknown as ReturnType<typeof vi.fn>,
};

function buildApp(): Hono {
  const app = new Hono();
  app.route("/api/import", importRouter);
  return app;
}

const SAMPLE_SURGE = `
[General]
loglevel = notify
ipv6 = false

[Proxy]
🇭🇰 HK = trojan, hk.example.com, 443, password=secret
🇯🇵 JP = ss, jp.example.com, 8388, encrypt-method=aes-128-gcm, password=pwd

[Proxy Group]
Auto = url-test, 🇭🇰 HK, 🇯🇵 JP, url=http://cp.cloudflare.com/generate_204, interval=600
Manual = select, Auto, DIRECT

[Rule]
RULE-SET, https://example.com/cn.list, DIRECT
RULE-SET, https://example.com/reject.list, REJECT-DROP

[URL Rewrite]
^https://www.google.com/url\\?.*url=([^&]+) $1 302
`;

beforeEach(() => {
  __idCounter = 0;
  // 默认所有 repo 是空的 → 第一次导入走"创建"分支。
  mocked.rulesetList.mockResolvedValue([]);
  mocked.groupList.mockResolvedValue([]);
  mocked.generalList.mockResolvedValue([]);
  mocked.moduleList.mockResolvedValue([]);
  mocked.rulesetSave.mockImplementation(async (data: unknown) => ({
    id: (data as { id: string }).id,
    path: "",
    mtimeMs: 0,
    data,
  }));
  mocked.groupSave.mockImplementation(async (data: unknown) => ({
    id: (data as { id: string }).id,
    path: "",
    mtimeMs: 0,
    data,
  }));
  mocked.generalSave.mockImplementation(async (data: unknown) => ({
    id: (data as { id: string }).id,
    path: "",
    mtimeMs: 0,
    data,
  }));
  mocked.moduleSave.mockImplementation(async (data: unknown) => ({
    id: (data as { id: string }).id,
    path: "",
    mtimeMs: 0,
    data,
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/import/commit (Surge)", () => {
  it("first import: creates general / rules / groups / modules / nodes", async () => {
    const res = await buildApp().request("/api/import/commit", {
      method: "POST",
      body: JSON.stringify({
        text: SAMPLE_SURGE,
        kind: "surge",
        file_name: "airport.conf",
      }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; stats: Record<string, number>; warnings: string[] };
    expect(body.ok).toBe(true);
    expect(body.stats.general).toBe(1);
    expect(body.stats.general_skipped).toBe(0);
    expect(body.stats.rules).toBe(2);
    expect(body.stats.rules_skipped).toBe(0);
    expect(body.stats.groups).toBe(2);
    expect(body.stats.groups_skipped).toBe(0);
    expect(body.stats.modules).toBe(1);
    expect(body.stats.modules_skipped).toBe(0);
    expect(body.stats.manual_nodes).toBe(2);

    expect(mocked.rulesetSave).toHaveBeenCalledTimes(2);
    expect(mocked.groupSave).toHaveBeenCalledTimes(2);
    expect(mocked.generalSave).toHaveBeenCalledTimes(1);
    expect(mocked.moduleSave).toHaveBeenCalledTimes(1);
    expect(mocked.writeManualNodes).toHaveBeenCalledTimes(1);
  });

  it("second import of the same file: dedups everything (no overwrite, no spam)", async () => {
    // 模拟第一次导入后落库的实体。
    const general = (await callCommit(buildApp())).savedGeneral;
    const rules = (await callCommit(buildApp())).savedRules;
    const groups = (await callCommit(buildApp())).savedGroups;
    const modules = (await callCommit(buildApp())).savedModules;

    vi.clearAllMocks();
    // 第二次导入前,假装 repo 里已经有同样身份的条目
    mocked.generalList.mockResolvedValue(general.map((g) => ({ id: g.id, path: "", mtimeMs: 0, data: g })));
    mocked.rulesetList.mockResolvedValue(rules.map((r) => ({ id: r.id, path: "", mtimeMs: 0, data: r })));
    mocked.groupList.mockResolvedValue(groups.map((g) => ({ id: g.id, path: "", mtimeMs: 0, data: g })));
    mocked.moduleList.mockResolvedValue(modules.map((m) => ({ id: m.id, path: "", mtimeMs: 0, data: m })));

    const res = await buildApp().request("/api/import/commit", {
      method: "POST",
      body: JSON.stringify({
        text: SAMPLE_SURGE,
        kind: "surge",
        file_name: "airport.conf",
      }),
      headers: { "Content-Type": "application/json" },
    });

    const body = (await res.json()) as { ok: boolean; stats: Record<string, number>; warnings: string[] };
    expect(body.stats.general).toBe(0);
    expect(body.stats.general_skipped).toBe(1);
    expect(body.stats.rules).toBe(0);
    expect(body.stats.rules_skipped).toBe(2);
    expect(body.stats.groups).toBe(0);
    expect(body.stats.groups_skipped).toBe(2);
    expect(body.stats.modules).toBe(0);
    expect(body.stats.modules_skipped).toBe(1);

    expect(mocked.generalSave).not.toHaveBeenCalled();
    expect(mocked.rulesetSave).not.toHaveBeenCalled();
    expect(mocked.groupSave).not.toHaveBeenCalled();
    expect(mocked.moduleSave).not.toHaveBeenCalled();

    // 警告里应该包含跳过提示
    expect(body.warnings.some((w) => /Skipped 2 duplicate rule/.test(w))).toBe(true);
    expect(body.warnings.some((w) => /Skipped 2 duplicate proxy-group/.test(w))).toBe(true);
    expect(body.warnings.some((w) => /Skipped 1 duplicate module/.test(w))).toBe(true);
    expect(body.warnings.some((w) => /Skipped general preset/.test(w))).toBe(true);
  });

  it("first import: every saved id matches imported-<slug>-<6-char> shape", async () => {
    await buildApp().request("/api/import/commit", {
      method: "POST",
      body: JSON.stringify({ text: SAMPLE_SURGE, kind: "surge", file_name: "airport.conf" }),
      headers: { "Content-Type": "application/json" },
    });
    // 所有四类菜单(general / rules / groups / modules)的 id 都遵循 imported-<slug>-<suffix>。
    // suffix 在测试里是 deterministic 的 m<base36>;生产代码用 6 位 nanoid。
    const idPattern = /^imported-(?:[a-z0-9-]+-)?[a-z0-9]{6}$/;
    const allIds = [
      ...mocked.generalSave.mock.calls,
      ...mocked.rulesetSave.mock.calls,
      ...mocked.groupSave.mock.calls,
      ...mocked.moduleSave.mock.calls,
    ].map((c) => (c[0] as { id: string }).id);

    expect(allIds.length).toBeGreaterThan(0);
    for (const id of allIds) {
      expect(id).toMatch(idPattern);
      // 任何一类的 id 都不会再退化成旧版固定字面量
      expect(id).not.toBe("imported");
      expect(id).not.toBe("imported-module");
    }
  });

  it("import with id collision but different content: writes with new imported id (no overwrite)", async () => {
    // 因为 mocked generateImportedId 是 deterministic 的(从 m00001 起递增),
    // SAMPLE_SURGE 里第二条 ruleset(reject)的 id 在第一次 commit 后会落在
    // imported-rule-reject-m00003。我们提前往 repo 里塞同 id 但内容不同的资源,
    // 触发 router.ensureUniqueId 的兜底分支(用同样的 imported-<slug>- 工厂重摇)。
    //
    // 调用顺序假设(与 importer 内部 generateImportedId 调用次序对齐):
    //   m00001 = general (airport-conf)
    //   m00002 = rule cn
    //   m00003 = rule reject  ← 撞库目标
    //   m00004 = group Auto
    //   m00005 = group Manual
    //   m00006 = module
    const collidingExisting = {
      id: "imported-rule-reject-m00003",
      name: "user-edited",
      type: "remote_url" as const,
      url: "https://other.example.com/list.list", // 内容不同 → 不会被 dedupBy 识别为重复
      behavior: "classical" as const,
      format: "text" as const,
      clash_format: "rule_provider" as const,
      surge_format: "rule_set" as const,
      update_interval: 86400,
    };
    mocked.rulesetList.mockResolvedValue([
      { id: collidingExisting.id, path: "", mtimeMs: 0, data: collidingExisting },
    ]);

    const res = await buildApp().request("/api/import/commit", {
      method: "POST",
      body: JSON.stringify({ text: SAMPLE_SURGE, kind: "surge", file_name: "airport.conf" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; stats: Record<string, number> };
    expect(mocked.rulesetSave).toHaveBeenCalledTimes(2);
    const savedIds = mocked.rulesetSave.mock.calls.map((c) => (c[0] as { id: string }).id);
    // 永不覆盖已存在的 imported id;撞库的那条会被重新摇号
    expect(savedIds).not.toContain("imported-rule-reject-m00003");
    expect(savedIds.every((id) => /^imported-rule-(cn|reject)-m[0-9a-z]{5}$/.test(id))).toBe(true);
    expect(body.stats.rules).toBe(2);
    expect(body.stats.rules_skipped).toBe(0);
  });
});

// 用真实路径触发一次 commit,把保存到 mocked save() 的实体收集出来供后续断言复用。
async function callCommit(app: Hono): Promise<{
  savedGeneral: Array<Record<string, unknown> & { id: string }>;
  savedRules: Array<Record<string, unknown> & { id: string }>;
  savedGroups: Array<Record<string, unknown> & { id: string }>;
  savedModules: Array<Record<string, unknown> & { id: string }>;
}> {
  await app.request("/api/import/commit", {
    method: "POST",
    body: JSON.stringify({
      text: SAMPLE_SURGE,
      kind: "surge",
      file_name: "airport.conf",
    }),
    headers: { "Content-Type": "application/json" },
  });
  return {
    savedGeneral: mocked.generalSave.mock.calls.map((c) => c[0] as Record<string, unknown> & { id: string }),
    savedRules: mocked.rulesetSave.mock.calls.map((c) => c[0] as Record<string, unknown> & { id: string }),
    savedGroups: mocked.groupSave.mock.calls.map((c) => c[0] as Record<string, unknown> & { id: string }),
    savedModules: mocked.moduleSave.mock.calls.map((c) => c[0] as Record<string, unknown> & { id: string }),
  };
}
