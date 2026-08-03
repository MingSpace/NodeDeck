import { describe, expect, it } from "vitest";
import { isHiddenSelectorEmpty, resolveHiddenNodeNames } from "../../src/generators/hidden-nodes.js";
import { profileSchema } from "../../src/schemas/profile.js";
import type { Node } from "../../src/schemas/node.js";

function node(name: string, overrides: Partial<Node> = {}): Node {
  return { name, type: "ss", server: "1.2.3.4", port: 443, tags: [], ...overrides };
}

const nodes = [
  node("HK 中转-01", { region: "HK", source_provider_id: "relay" }),
  node("JP 落地-01", { region: "JP", source_provider_id: "landing", type: "trojan" }),
  node("JP 落地-02", { region: "JP", source_provider_id: "landing" }),
  node("US-01", { region: "US", source_provider_id: "landing" }),
];

describe("isHiddenSelectorEmpty", () => {
  it("treats undefined and an all-empty selector as 'hide nothing'", () => {
    expect(isHiddenSelectorEmpty(undefined)).toBe(true);
    expect(isHiddenSelectorEmpty({})).toBe(true);
    expect(
      isHiddenSelectorEmpty({
        from_providers: [],
        include_region: [],
        include_type: [],
        exclude_type: [],
        include_nodes: [],
      }),
    ).toBe(true);
  });

  it("is non-empty as soon as any single condition is set", () => {
    expect(isHiddenSelectorEmpty({ include_regex: "落地" })).toBe(false);
    expect(isHiddenSelectorEmpty({ exclude_regex: "中转" })).toBe(false);
    expect(isHiddenSelectorEmpty({ from_providers: ["landing"] })).toBe(false);
    expect(isHiddenSelectorEmpty({ include_region: ["JP"] })).toBe(false);
    expect(isHiddenSelectorEmpty({ include_type: ["ss"] })).toBe(false);
    expect(isHiddenSelectorEmpty({ exclude_type: ["ss"] })).toBe(false);
    expect(isHiddenSelectorEmpty({ include_nodes: ["US-01"] })).toBe(false);
  });
});

describe("resolveHiddenNodeNames", () => {
  it("hides nothing when the selector is absent or empty", () => {
    expect(resolveHiddenNodeNames(nodes).size).toBe(0);
    expect(resolveHiddenNodeNames(nodes, {}).size).toBe(0);
  });

  it("matches by name regex (case-insensitive, same as chain selector)", () => {
    expect([...resolveHiddenNodeNames(nodes, { include_regex: "落地" })]).toEqual([
      "JP 落地-01",
      "JP 落地-02",
    ]);
    expect([...resolveHiddenNodeNames(nodes, { include_regex: "us-01" })]).toEqual(["US-01"]);
  });

  it("matches by provider / region / type", () => {
    expect([...resolveHiddenNodeNames(nodes, { from_providers: ["relay"] })]).toEqual(["HK 中转-01"]);
    expect([...resolveHiddenNodeNames(nodes, { include_region: ["JP"] })]).toEqual([
      "JP 落地-01",
      "JP 落地-02",
    ]);
    expect([...resolveHiddenNodeNames(nodes, { include_type: ["trojan"] })]).toEqual(["JP 落地-01"]);
  });

  it("ANDs conditions and unions explicitly named nodes with them", () => {
    // include_nodes 与其余条件是 AND(与 chain/apply.ts matchesSelector 同一套语义):
    // 点名 US-01 但同时要求 region=JP → 谁都不命中。
    expect(
      resolveHiddenNodeNames(nodes, { include_nodes: ["US-01"], include_region: ["JP"] }).size,
    ).toBe(0);
    expect([...resolveHiddenNodeNames(nodes, { include_nodes: ["US-01", "JP 落地-02"] })]).toEqual([
      "JP 落地-02",
      "US-01",
    ]);
    expect([
      ...resolveHiddenNodeNames(nodes, { from_providers: ["landing"], exclude_regex: "落地" }),
    ]).toEqual(["US-01"]);
  });

  it("hides nothing on an invalid include regex (chain selector semantics)", () => {
    // 与 group selector 相反:宁可不隐藏,也不能因为正则写错就把整个节点池藏起来。
    expect(resolveHiddenNodeNames(nodes, { include_regex: "[invalid" }).size).toBe(0);
  });
});

describe("profile.hidden_nodes schema", () => {
  const base = {
    id: "home",
    name: "Home",
    token: "abcdefghij12",
  };

  it("stays absent when not configured (no empty selector noise in yaml)", () => {
    const parsed = profileSchema.parse(base);
    expect(parsed.hidden_nodes).toBeUndefined();
  });

  it("fills array defaults once the field exists", () => {
    const parsed = profileSchema.parse({ ...base, hidden_nodes: { include_regex: "落地" } });
    expect(parsed.hidden_nodes).toEqual({
      include_regex: "落地",
      from_providers: [],
      include_region: [],
      include_type: [],
      exclude_type: [],
      include_nodes: [],
    });
  });
});
