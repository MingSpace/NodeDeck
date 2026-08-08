import { describe, expect, it } from "vitest";
import { buildFlowGraph } from "../../src/generators/flow-graph.js";
import {
  buildGroupMemberIndex,
  resolveGroupMemberEntries,
} from "../../src/generators/group-members.js";
import type { Node } from "../../src/schemas/node.js";
import type { ProxyGroup } from "../../src/schemas/proxy-group.js";
import type { RuleSet } from "../../src/schemas/ruleset.js";
import type { ChainPath } from "../../src/chain/apply.js";

function node(name: string, overrides: Partial<Node> = {}): Node {
  return { name, type: "ss", server: "1.2.3.4", port: 443, tags: [], ...overrides };
}

function group(name: string, overrides: Partial<ProxyGroup> = {}): ProxyGroup {
  return { id: name, name, type: "select", proxies: [], nested_groups: [], ...overrides };
}

function ruleset(id: string, overrides: Partial<RuleSet> = {}): RuleSet {
  return {
    id,
    name: id,
    type: "remote_url",
    url: "https://example.com/list.conf",
    behavior: "classical",
    format: "yaml",
    clash_format: "rule_provider",
    surge_format: "rule_set",
    update_interval: 86400,
    ...overrides,
  } as RuleSet;
}

describe("resolveGroupMemberEntries", () => {
  const nodes = [node("JP-01", { region: "JP" }), node("JP-02", { region: "JP" }), node("HK-01", { region: "HK" })];

  it("orders members as proxies → nested_groups → selector", () => {
    const g = group("AI", {
      type: "fallback",
      proxies: ["Landing"],
      nested_groups: ["AI-Backup"],
      selector: { include_region: ["JP"], include_other_group: [], from_providers: [], exclude_type: [] },
    });
    const entries = resolveGroupMemberEntries(g, [...nodes, node("Landing")], {
      inlineIncludeOtherGroup: false,
      emptyFallback: true,
    });
    // fallback 组的顺序就是优先级,这条断言是在钉死"落地在前、兜底在后"能被配出来
    expect(entries).toEqual([
      { name: "Landing", origin: "explicit" },
      { name: "AI-Backup", origin: "nested" },
      { name: "JP-01", origin: "selector" },
      { name: "JP-02", origin: "selector" },
    ]);
  });

  it("keeps the first occurrence when a name appears in several sources", () => {
    const g = group("G", {
      proxies: ["JP-01"],
      selector: { include_region: ["JP"], include_other_group: [], from_providers: [], exclude_type: [] },
    });
    const entries = resolveGroupMemberEntries(g, nodes, {
      inlineIncludeOtherGroup: false,
      emptyFallback: true,
    });
    expect(entries).toEqual([
      { name: "JP-01", origin: "explicit" },
      { name: "JP-02", origin: "selector" },
    ]);
  });

  it("inlines include_other_group only for the clash side", () => {
    const g = group("G", { proxies: ["JP-01"], include_other_group: "Other" });
    expect(
      resolveGroupMemberEntries(g, nodes, { inlineIncludeOtherGroup: true, emptyFallback: true }),
    ).toEqual([
      { name: "JP-01", origin: "explicit" },
      { name: "Other", origin: "other_group" },
    ]);
    expect(
      resolveGroupMemberEntries(g, nodes, { inlineIncludeOtherGroup: false, emptyFallback: true }),
    ).toEqual([{ name: "JP-01", origin: "explicit" }]);
  });

  it("keeps explicitly pinned hidden nodes but drops them from selector matching", () => {
    const g = group("G", {
      proxies: ["JP-01"],
      selector: { include_region: ["JP"], include_other_group: [], from_providers: [], exclude_type: [] },
    });
    const entries = resolveGroupMemberEntries(g, nodes, {
      hiddenNodes: new Set(["JP-01", "JP-02"]),
      inlineIncludeOtherGroup: false,
      emptyFallback: true,
    });
    expect(entries).toEqual([{ name: "JP-01", origin: "explicit" }]);
  });

  it("falls back to DIRECT only when asked", () => {
    const g = group("Empty");
    expect(
      resolveGroupMemberEntries(g, nodes, { inlineIncludeOtherGroup: false, emptyFallback: true }),
    ).toEqual([{ name: "DIRECT", origin: "fallback" }]);
    expect(
      resolveGroupMemberEntries(g, nodes, { inlineIncludeOtherGroup: false, emptyFallback: false }),
    ).toEqual([]);
  });
});

describe("buildFlowGraph", () => {
  // 复刻用户场景:AI = fallback(链式落地节点, 机场 smart 组)
  const nodes = [
    node("Landing", { chain_via: "AI-机场" }),
    node("JP-01", { region: "JP" }),
    node("JP-02", { region: "JP" }),
  ];
  const groups = [
    group("AI", { type: "fallback", proxies: ["Landing"], nested_groups: ["AI-机场"], interval: 300 }),
    group("AI-机场", {
      type: "smart",
      selector: { include_region: ["JP"], include_other_group: [], from_providers: [], exclude_type: [] },
    }),
  ];
  const chains: ChainPath[] = [{ node: "Landing", path: ["Landing", "AI-机场"], terminal: "group" }];

  function build(overrides: Partial<Parameters<typeof buildFlowGraph>[0]> = {}) {
    return buildFlowGraph({
      groups,
      nodes,
      chains,
      groupMembers: buildGroupMemberIndex(groups, nodes),
      hiddenNodes: new Set(),
      rules: [{ ref: "ai", policy: "AI", ruleset: ruleset("AI 规则") }],
      ...overrides,
    });
  }

  it("classifies members and attaches the resolved chain path", () => {
    const ai = build().groups.find((g) => g.name === "AI");
    expect(ai?.members).toEqual([
      { name: "Landing", kind: "node", origin: "explicit", chain_path: ["Landing", "AI-机场"] },
      { name: "AI-机场", kind: "group", origin: "nested" },
    ]);
    expect(ai?.node_total).toBe(3);
  });

  it("emits rule entries in generator order, then GEOIP, then FINAL", () => {
    const graph = build({
      geoipFallback: { policy: "DIRECT" },
      finalRule: { policy: "Proxys", dns_failed: true },
    });
    expect(graph.entries.map((e) => [e.kind, e.policy, e.policy_kind])).toEqual([
      ["ruleset", "AI", "group"],
      ["geoip", "DIRECT", "builtin"],
      // Proxys 组没在这个 profile 里 → unknown,UI 会提示引用不到
      ["final", "Proxys", "unknown"],
    ]);
  });

  it("warns that a Surge smart group silently ignores nested groups", () => {
    const withNested = [
      group("Bad", { type: "smart", nested_groups: ["AI-机场"], proxies: ["DIRECT"] }),
      groups[1],
    ];
    const graph = buildFlowGraph({
      groups: withNested,
      nodes,
      chains: [],
      groupMembers: buildGroupMemberIndex(withNested, nodes),
      hiddenNodes: new Set(),
      rules: [],
    });
    const notes = graph.groups[0].notes.filter((n) => n.level === "warn");
    expect(notes.some((n) => n.text.includes("静默忽略"))).toBe(true);
    // DIRECT 与嵌套组都会被 Surge 丢掉,提示里要把两者都点名
    expect(notes.some((n) => n.text.includes("DIRECT") && n.text.includes("AI-机场"))).toBe(true);
  });

  it("warns when a fallback group leaves interval unset", () => {
    const noInterval = [group("AI", { type: "fallback", proxies: ["JP-01", "JP-02"] })];
    const graph = buildFlowGraph({
      groups: noInterval,
      nodes,
      chains: [],
      groupMembers: buildGroupMemberIndex(noInterval, nodes),
      hiddenNodes: new Set(),
      rules: [],
    });
    expect(graph.groups[0].notes.some((n) => n.text.includes("600 秒"))).toBe(true);
    // 配了 interval 就不该再提示
    expect(build().groups[0].notes.some((n) => n.text.includes("600 秒"))).toBe(false);
  });

  it("samples selector members but never drops a chained one", () => {
    const many = Array.from({ length: 20 }, (_, i) => node(`JP-${i}`, { region: "JP" }));
    many[19] = { ...many[19], chain_via: "DIRECT" };
    const g = [
      group("Big", {
        selector: { include_region: ["JP"], include_other_group: [], from_providers: [], exclude_type: [] },
      }),
    ];
    const graph = buildFlowGraph({
      groups: g,
      nodes: many,
      chains: [{ node: "JP-19", path: ["JP-19", "DIRECT"], terminal: "builtin" }],
      groupMembers: buildGroupMemberIndex(g, many),
      hiddenNodes: new Set(),
      rules: [],
    });
    const flow = graph.groups[0];
    expect(flow.selector_omitted).toBe(13);
    expect(flow.members.map((m) => m.name)).toContain("JP-19");
    expect(flow.node_total).toBe(20);
  });
});
