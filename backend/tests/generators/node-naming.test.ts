import { describe, expect, it } from "vitest";
import { uniquifyNodeNames, escapeSurgeNames } from "../../src/generators/node-naming.js";
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
