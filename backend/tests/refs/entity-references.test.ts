import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/storage/repos.js", () => ({
  providerRepo: { list: vi.fn() },
  rulesetRepo: { list: vi.fn() },
  proxyGroupRepo: { list: vi.fn() },
  generalPresetRepo: { list: vi.fn() },
  surgeModuleRepo: { list: vi.fn() },
  profileRepo: { list: vi.fn() },
}));
vi.mock("../../src/storage/notification-store.js", () => ({
  loadNotificationConfig: vi.fn(),
}));

import {
  rulesetRepo,
  proxyGroupRepo,
  generalPresetRepo,
  profileRepo,
} from "../../src/storage/repos.js";
import { loadNotificationConfig } from "../../src/storage/notification-store.js";
import {
  findEntityReferences,
  describeReferences,
  isReferenceableKind,
} from "../../src/refs/entity-references.js";
import { profileSchema } from "../../src/schemas/profile.js";
import { proxyGroupSchema } from "../../src/schemas/proxy-group.js";
import { rulesetSchema } from "../../src/schemas/ruleset.js";
import { generalPresetSchema } from "../../src/schemas/general-preset.js";
import { defaultNotificationConfig } from "../../src/schemas/notification.js";

type Mock = ReturnType<typeof vi.fn>;

// repo.list() 返回 FileEntry[];引用扫描只读 .data,其余字段给占位值。
function entries<T extends { id: string }>(items: T[]): { id: string; path: string; mtimeMs: number; data: T }[] {
  return items.map((data) => ({ id: data.id, path: "", mtimeMs: 0, data }));
}

function profile(overrides: Record<string, unknown> = {}) {
  return profileSchema.parse({
    id: "p1",
    name: "家用",
    token: "token-abcdefgh",
    ...overrides,
  });
}

function group(overrides: Record<string, unknown> = {}) {
  return proxyGroupSchema.parse({ id: "g-proxy", name: "Proxy", ...overrides });
}

function ruleset(overrides: Record<string, unknown> = {}) {
  return rulesetSchema.parse({
    id: "rs-1",
    name: "规则集 1",
    type: "inline_list",
    payload: ["DOMAIN-SUFFIX,example.com"],
    ...overrides,
  });
}

function general(overrides: Record<string, unknown> = {}) {
  return generalPresetSchema.parse({ id: "gen-1", name: "默认全局", ...overrides });
}

/** 装配一套 data/ 快照;未给出的实体一律为空。 */
function setSources(s: {
  profiles?: ReturnType<typeof profile>[];
  groups?: ReturnType<typeof group>[];
  rules?: ReturnType<typeof ruleset>[];
  generals?: ReturnType<typeof general>[];
  providerIds?: string[] | null;
}): void {
  (profileRepo.list as unknown as Mock).mockResolvedValue(entries(s.profiles ?? []));
  (proxyGroupRepo.list as unknown as Mock).mockResolvedValue(entries(s.groups ?? []));
  (rulesetRepo.list as unknown as Mock).mockResolvedValue(entries(s.rules ?? []));
  (generalPresetRepo.list as unknown as Mock).mockResolvedValue(entries(s.generals ?? []));
  const notification = defaultNotificationConfig();
  notification.events.userinfo_alert.provider_ids = s.providerIds ?? null;
  (loadNotificationConfig as unknown as Mock).mockResolvedValue(notification);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("isReferenceableKind", () => {
  it("profiles 不参与引用检查(没有实体引用 profile)", () => {
    expect(isReferenceableKind("profiles")).toBe(false);
    expect(isReferenceableKind("groups")).toBe(true);
    expect(isReferenceableKind("rules")).toBe(true);
    expect(isReferenceableKind("bogus")).toBe(false);
  });
});

describe("findEntityReferences: groups", () => {
  it("未被任何实体引用 → 空数组", async () => {
    setSources({ profiles: [profile()], groups: [group()] });
    expect(await findEntityReferences("groups", "g-proxy")).toEqual([]);
  });

  it("profile.proxy_groups 按 id 引用", async () => {
    setSources({ profiles: [profile({ proxy_groups: ["g-proxy"] })], groups: [group()] });
    const refs = await findEntityReferences("groups", "g-proxy");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      from_kind: "profiles",
      from_id: "p1",
      from_name: "家用",
      field: "proxy_groups",
      via: "id",
      blocking: true,
    });
  });

  it("rule_modules.policy / final / geoip 兜底策略按 name 引用", async () => {
    setSources({
      profiles: [
        profile({
          rule_modules: [
            { ref: "rs-1", policy: "Proxy" },
            { geoip_cn: true, policy: "Proxy" },
            { final: "Proxy" },
          ],
        }),
      ],
      groups: [group()],
    });
    const refs = await findEntityReferences("groups", "g-proxy");
    expect(refs.map((r) => r.field)).toEqual([
      "rule_modules[0].policy",
      "rule_modules[1].policy",
      "rule_modules[2].final",
    ]);
    expect(refs.every((r) => r.via === "name" && r.blocking)).toBe(true);
  });

  it("chain_rules 的 via 与 selector.include_groups 按 name 引用", async () => {
    setSources({
      profiles: [
        profile({
          chain_rules: [
            { via: "Proxy" },
            { via: "landing", selector: { include_groups: ["Proxy"] } },
          ],
        }),
      ],
      groups: [group()],
    });
    const refs = await findEntityReferences("groups", "g-proxy");
    expect(refs.map((r) => r.field)).toEqual([
      "chain_rules[0].via",
      "chain_rules[1].selector.include_groups",
    ]);
  });

  it("其它组的 nested_groups / include_other_group / ssid_params 按 name 引用", async () => {
    setSources({
      groups: [
        group(),
        group({ id: "g-a", name: "A", nested_groups: ["Proxy"] }),
        group({ id: "g-b", name: "B", include_other_group: "Proxy" }),
        group({
          id: "g-c",
          name: "C",
          type: "ssid",
          ssid_params: { default: "Proxy", cellular: "DIRECT", wifi: { Home: "Proxy" } },
        }),
      ],
    });
    const refs = await findEntityReferences("groups", "g-proxy");
    expect(refs.map((r) => `${r.from_id}:${r.field}`)).toEqual([
      "g-a:nested_groups",
      "g-b:include_other_group",
      "g-c:ssid_params.default",
      "g-c:ssid_params.wifi[Home]",
    ]);
  });

  it("generals.ssid_rules[].policy 按 name 引用", async () => {
    setSources({
      groups: [group()],
      generals: [general({ ssid_rules: [{ ssid: "Home" }, { ssid: "Cafe", policy: "Proxy" }] })],
    });
    const refs = await findEntityReferences("groups", "g-proxy");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      from_kind: "generals",
      from_id: "gen-1",
      field: "ssid_rules[1].policy",
    });
  });

  it("ruleset.policy 只是建议策略,标为 non-blocking", async () => {
    setSources({ groups: [group()], rules: [ruleset({ policy: "Proxy" })] });
    const refs = await findEntityReferences("groups", "g-proxy");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ from_kind: "rules", field: "policy", blocking: false });
  });

  it("存在同名的另一个组时,按 name 的引用删掉也不悬空 → 不算引用", async () => {
    setSources({
      profiles: [profile({ rule_modules: [{ ref: "rs-1", policy: "Proxy" }] })],
      groups: [group(), group({ id: "g-proxy-2", name: "Proxy" })],
    });
    expect(await findEntityReferences("groups", "g-proxy")).toEqual([]);
  });

  it("组文件已不存在(只剩 profile 里的 id)时仍能报出 id 引用", async () => {
    setSources({ profiles: [profile({ proxy_groups: ["g-proxy"] })], groups: [] });
    const refs = await findEntityReferences("groups", "g-proxy");
    expect(refs.map((r) => r.field)).toEqual(["proxy_groups"]);
  });
});

describe("findEntityReferences: rules", () => {
  it("profile.rule_modules[].ref 按 id 引用", async () => {
    setSources({
      profiles: [
        profile({
          rule_modules: [{ final: "DIRECT" }, { ref: "rs-1", policy: "Proxy" }],
        }),
      ],
      rules: [ruleset()],
    });
    const refs = await findEntityReferences("rules", "rs-1");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ field: "rule_modules[1].ref", via: "id", blocking: true });
  });

  it("没有 profile 引入 → 空数组", async () => {
    setSources({ profiles: [profile()], rules: [ruleset()] });
    expect(await findEntityReferences("rules", "rs-1")).toEqual([]);
  });
});

describe("findEntityReferences: providers", () => {
  it("覆盖 profile / group / 通知设置里的全部 id 引用点", async () => {
    setSources({
      profiles: [
        profile({
          providers: ["airport-a"],
          userinfo: { enabled: true, mode: "primary", primary_provider: "airport-a" },
          chain_rules: [{ via: "landing", selector: { from_providers: ["airport-a"] } }],
          hidden_nodes: { from_providers: ["airport-a"] },
        }),
      ],
      groups: [
        group({ id: "g-a", name: "A", selector: { from_providers: ["airport-a"] } }),
        group({ id: "g-b", name: "B", use: ["airport-a"] }),
      ],
      providerIds: ["airport-a"],
    });
    const refs = await findEntityReferences("providers", "airport-a");
    expect(refs.map((r) => `${r.from_kind}/${r.from_id}:${r.field}`)).toEqual([
      "profiles/p1:providers",
      "profiles/p1:userinfo.primary_provider",
      "profiles/p1:chain_rules[0].selector.from_providers",
      "profiles/p1:hidden_nodes.from_providers",
      "groups/g-a:selector.from_providers",
      "groups/g-b:use",
      "notification/notification:events.userinfo_alert.provider_ids",
    ]);
    expect(refs.every((r) => r.blocking)).toBe(true);
  });

  it("通知设置 provider_ids=null(全部启用的源)不算对具体 id 的引用", async () => {
    setSources({ providerIds: null });
    expect(await findEntityReferences("providers", "airport-a")).toEqual([]);
  });
});

describe("findEntityReferences: generals / modules", () => {
  it("profile.general_preset 按 id 引用", async () => {
    setSources({ profiles: [profile({ general_preset: "gen-1" })], generals: [general()] });
    const refs = await findEntityReferences("generals", "gen-1");
    expect(refs.map((r) => r.field)).toEqual(["general_preset"]);
  });

  it("profile.surge_modules 按 id 引用", async () => {
    setSources({ profiles: [profile({ surge_modules: ["mod-1"] })] });
    const refs = await findEntityReferences("modules", "mod-1");
    expect(refs.map((r) => r.field)).toEqual(["surge_modules"]);
  });
});

describe("describeReferences", () => {
  it("超出 limit 时给出总数", async () => {
    setSources({
      profiles: [
        profile({ proxy_groups: ["g-proxy"] }),
        profile({ id: "p2", name: "备用", proxy_groups: ["g-proxy"] }),
        profile({ id: "p3", name: "测试", proxy_groups: ["g-proxy"] }),
        profile({ id: "p4", name: "旧的", proxy_groups: ["g-proxy"] }),
      ],
      groups: [group()],
    });
    const refs = await findEntityReferences("groups", "g-proxy");
    expect(describeReferences(refs)).toBe(
      "Profile「家用」的 proxy_groups、Profile「备用」的 proxy_groups、Profile「测试」的 proxy_groups 等 4 处",
    );
  });

  it("未超出 limit 时不带总数", () => {
    expect(
      describeReferences([
        {
          from_kind: "groups",
          from_id: "g-a",
          from_name: "A",
          field: "nested_groups",
          via: "name",
          value: "Proxy",
          blocking: true,
        },
      ]),
    ).toBe("策略组「A」的 nested_groups");
  });
});
