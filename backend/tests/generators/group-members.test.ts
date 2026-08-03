import { describe, expect, it } from "vitest";
import { buildGroupMemberIndex, filterNodesBySelector } from "../../src/generators/group-members.js";
import type { Node } from "../../src/schemas/node.js";
import type { ProxyGroup } from "../../src/schemas/proxy-group.js";

function node(name: string, overrides: Partial<Node> = {}): Node {
  return { name, type: "ss", server: "1.2.3.4", port: 443, tags: [], ...overrides };
}

function group(name: string, overrides: Partial<ProxyGroup> = {}): ProxyGroup {
  return { id: name, name, type: "select", proxies: [], nested_groups: [], ...overrides };
}

describe("filterNodesBySelector", () => {
  const nodes = [
    node("🇭🇰 HK-01", { region: "HK", source_provider_id: "a" }),
    node("🇯🇵 JP-01", { region: "JP", source_provider_id: "a", type: "trojan" }),
    node("🇯🇵 JP-02", { region: "JP", source_provider_id: "b" }),
    node("??? Unknown", { source_provider_id: "b" }),
  ];

  it("returns the whole pool for an empty selector, preserving order", () => {
    expect(filterNodesBySelector(nodes, {}).map((n) => n.name)).toEqual(nodes.map((n) => n.name));
  });

  it("ANDs from_providers / include_region / exclude_type / regexes", () => {
    expect(filterNodesBySelector(nodes, { from_providers: ["a"] }).map((n) => n.name)).toEqual([
      "🇭🇰 HK-01",
      "🇯🇵 JP-01",
    ]);
    // region 白名单会把 region 未识别的节点一并排除
    expect(filterNodesBySelector(nodes, { include_region: ["JP"] }).map((n) => n.name)).toEqual([
      "🇯🇵 JP-01",
      "🇯🇵 JP-02",
    ]);
    expect(filterNodesBySelector(nodes, { exclude_type: ["trojan"] }).map((n) => n.name)).toEqual([
      "🇭🇰 HK-01",
      "🇯🇵 JP-02",
      "??? Unknown",
    ]);
    expect(filterNodesBySelector(nodes, { include_regex: "jp" }).map((n) => n.name)).toEqual([
      "🇯🇵 JP-01",
      "🇯🇵 JP-02",
    ]);
    expect(
      filterNodesBySelector(nodes, { include_regex: "JP", exclude_regex: "02" }).map((n) => n.name),
    ).toEqual(["🇯🇵 JP-01"]);
  });

  it("ignores invalid regexes so group members are never silently emptied", () => {
    // 与 chain/apply.ts 的 matchesSelector 相反:组成员宁可多不可少,
    // 少了会让客户端报 "proxy not found"。
    expect(filterNodesBySelector(nodes, { include_regex: "[invalid" })).toHaveLength(nodes.length);
    expect(filterNodesBySelector(nodes, { exclude_regex: "[invalid" })).toHaveLength(nodes.length);
  });
});

describe("buildGroupMemberIndex", () => {
  const nodes = [
    node("HK-01", { region: "HK" }),
    node("JP-01", { region: "JP" }),
    node("US-01", { region: "US" }),
  ];

  it("collects explicit proxies and drops builtin policies / dangling names", () => {
    const groups = [group("Manual", { proxies: ["HK-01", "DIRECT", "Ghost"] })];
    const index = buildGroupMemberIndex(groups, nodes);
    expect([...index.get("Manual")!]).toEqual(["HK-01"]);
  });

  it("collects selector-driven members", () => {
    const groups = [group("JP", { selector: { include_region: ["JP"] } as ProxyGroup["selector"] })];
    const index = buildGroupMemberIndex(groups, nodes);
    expect([...index.get("JP")!]).toEqual(["JP-01"]);
  });

  it("expands nested_groups transitively", () => {
    const groups = [
      group("Leaf", { proxies: ["US-01"] }),
      group("Mid", { proxies: ["JP-01"], nested_groups: ["Leaf"] }),
      group("Top", { proxies: ["HK-01"], nested_groups: ["Mid"] }),
    ];
    const index = buildGroupMemberIndex(groups, nodes);
    expect([...index.get("Top")!].sort()).toEqual(["HK-01", "JP-01", "US-01"]);
    expect([...index.get("Mid")!].sort()).toEqual(["JP-01", "US-01"]);
  });

  it("expands Surge-style include_other_group as well", () => {
    const groups = [
      group("Pool", { proxies: ["JP-01"] }),
      group("Front", { proxies: ["HK-01"], include_other_group: "Pool" }),
    ];
    const index = buildGroupMemberIndex(groups, nodes);
    expect([...index.get("Front")!].sort()).toEqual(["HK-01", "JP-01"]);
  });

  it("breaks nested group cycles instead of recursing forever", () => {
    const groups = [
      group("A", { proxies: ["HK-01"], nested_groups: ["B"] }),
      group("B", { proxies: ["JP-01"], nested_groups: ["A"] }),
    ];
    const index = buildGroupMemberIndex(groups, nodes);
    expect([...index.get("A")!].sort()).toEqual(["HK-01", "JP-01"]);
    expect([...index.get("B")!].sort()).toEqual(["HK-01", "JP-01"]);
  });

  it("drops hidden nodes from selector matches but keeps explicit ones", () => {
    // 与两端 generator 的 resolveGroupMembers 同一套口径:隐藏只挡动态匹配。
    const groups = [
      group("Auto", { selector: { include_region: ["JP"] } as ProxyGroup["selector"] }),
      group("Landing", { proxies: ["JP-01"] }),
    ];
    const index = buildGroupMemberIndex(groups, nodes, { hiddenNodes: new Set(["JP-01"]) });
    expect([...index.get("Auto")!]).toEqual([]);
    expect([...index.get("Landing")!]).toEqual(["JP-01"]);
  });

  it("treats a group name written into proxies as a group reference", () => {
    const groups = [
      group("Pool", { proxies: ["JP-01"] }),
      group("Mixed", { proxies: ["HK-01", "Pool"] }),
    ];
    const index = buildGroupMemberIndex(groups, nodes);
    expect([...index.get("Mixed")!].sort()).toEqual(["HK-01", "JP-01"]);
  });
});
