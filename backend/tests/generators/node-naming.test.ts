import { describe, expect, it } from "vitest";
import { uniquifyNodeNames, escapeSurgeNames, buildProviderLabels } from "../../src/generators/node-naming.js";
import { providerSchema } from "../../src/schemas/provider.js";
import type { Node } from "../../src/schemas/node.js";
import type { ProxyGroup } from "../../src/schemas/proxy-group.js";

function node(name: string, providerId?: string): Node {
  return {
    name,
    type: "ss",
    server: "s.example.com",
    port: 8388,
    cipher: "aes-128-gcm",
    password: "x",
    source_provider_id: providerId,
    tags: [],
  };
}

function group(overrides: Partial<ProxyGroup> & { id: string; name: string }): ProxyGroup {
  return { type: "select", proxies: [], nested_groups: [], ...overrides };
}

describe("uniquifyNodeNames", () => {
  it("撞名加来源前缀后,把组的单值引用一并改写到第一个同名节点", () => {
    // A / B 两个机场各有一个 "Relay",都会被加上 【】 前缀 —— 包括"第一个"。
    // 单值引用(underlying_proxy / include_other_group)取列表首项,
    // 漏改就会让 Surge 报 "underlying-proxy not found"。
    const nodes = [node("Relay", "pa"), node("Relay", "pb"), node("JP-01", "pa")];
    const groups = [
      group({ id: "Landing", name: "Landing", proxies: ["JP-01"], underlying_proxy: "Relay" }),
    ];
    const warnings: string[] = [];
    const out = uniquifyNodeNames(nodes, warnings, {
      groups,
      providerLabels: new Map([
        ["pa", "A"],
        ["pb", "B"],
      ]),
    });

    expect(out.nodes.map((n) => n.name)).toEqual(["【A】Relay", "【B】Relay", "JP-01"]);
    expect(out.groups[0].underlying_proxy).toBe("【A】Relay");
  });

  it("没有撞名时不动 underlying_proxy", () => {
    const nodes = [node("Relay", "pa"), node("JP-01", "pa")];
    const groups = [group({ id: "Landing", name: "Landing", underlying_proxy: "Relay" })];
    const out = uniquifyNodeNames(nodes, [], { groups, providerLabels: new Map([["pa", "A"]]) });
    expect(out.groups[0].underlying_proxy).toBe("Relay");
  });
});

describe("buildProviderLabels", () => {
  const prov = (id: string, name: string, name_prefix?: string) =>
    providerSchema.parse({ id, name, type: "http", url: "https://example.com/sub", name_prefix });
  const labels = (...ps: ReturnType<typeof prov>[]) => [...buildProviderLabels(ps).values()];

  it("默认取 1 个字:中日韩名取首字,拉丁名取首字母大写,跳过 emoji 与标点", () => {
    expect(labels(prov("a", "奶昔云"), prov("b", "kona"), prov("c", "🚀 Apex!"))).toEqual(["奶", "K", "A"]);
  });

  it("1 个字撞了 → 撞的双方都升到 2 个字(与排序无关)", () => {
    expect(labels(prov("a", "Kona"), prov("b", "Kuro"), prov("c", "奶昔"), prov("d", "奶牛"))).toEqual([
      "Ko",
      "Ku",
      "奶昔",
      "奶牛",
    ]);
  });

  it("多词 / 驼峰拉丁名的 2 字档取词首", () => {
    expect(labels(prov("a", "Just My Socks"), prov("b", "JustMySocks Lite"), prov("c", "Jiasu"))).toEqual([
      "JM",
      "JM2",
      "Ji",
    ]);
  });

  it("显式 name_prefix 优先,并占住名额让自动取字避开", () => {
    expect(labels(prov("a", "Kona", "主力"), prov("b", "Apex", "K"), prov("c", "Kuro"))).toEqual(["主力", "K", "Ku"]);
  });

  it("名称取不出字 → 退化为 id", () => {
    expect(labels(prov("zeta", "🚀🚀"))).toEqual(["Z"]);
  });
});

describe("uniquifyNodeNames prefixAll", () => {
  it("不撞名的节点也加前缀并记 unprefixed_name;无来源节点保持原名", () => {
    const warnings: string[] = [];
    const out = uniquifyNodeNames([node("HK", "pa"), node("Manual")], warnings, {
      providerLabels: new Map([["pa", "A"]]),
      prefixAll: true,
      groups: [group({ id: "G", name: "G", proxies: ["HK", "Manual"] })],
    });
    expect(out.nodes.map((n) => [n.name, n.unprefixed_name])).toEqual([
      ["【A】HK", "HK"],
      ["Manual", undefined],
    ]);
    expect(out.groups[0].proxies).toEqual(["【A】HK", "Manual"]);
    expect(warnings).toEqual([]);
  });

  it("加前缀后仍撞名才记 warning", () => {
    const warnings: string[] = [];
    const out = uniquifyNodeNames([node("HK", "pa"), node("HK", "pa")], warnings, {
      providerLabels: new Map([["pa", "A"]]),
      prefixAll: true,
    });
    expect(out.nodes.map((n) => n.name)).toEqual(["【A】HK", "【A】HK #2"]);
    expect(warnings).toHaveLength(1);
  });
});

describe("escapeSurgeNames", () => {
  it("净化非法字符时同步改写 underlying_proxy(节点名与组名两种目标都算)", () => {
    const nodes = [node("Relay=A"), node("JP-01")];
    const groups = [
      group({ id: "Front", name: 'Front"Pool' }),
      group({ id: "L1", name: "L1", underlying_proxy: "Relay=A" }),
      group({ id: "L2", name: "L2", underlying_proxy: 'Front"Pool' }),
    ];
    const warnings: string[] = [];
    const out = escapeSurgeNames(nodes, groups, warnings);

    expect(out.nodes[0].name).toBe("Relay_A");
    expect(out.groups[0].name).toBe("Front_Pool");
    expect(out.groups[1].underlying_proxy).toBe("Relay_A");
    expect(out.groups[2].underlying_proxy).toBe("Front_Pool");
  });
});
