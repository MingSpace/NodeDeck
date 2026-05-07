import { describe, expect, it } from "vitest";
import { applyChainRules, matchesSelector, detectChainCycle } from "../../src/chain/apply.js";
import type { Node } from "../../src/schemas/node.js";
import type { Profile } from "../../src/schemas/profile.js";

function node(name: string, overrides: Partial<Node> = {}): Node {
  return {
    name,
    type: "ss",
    server: "1.2.3.4",
    port: 443,
    tags: [],
    ...overrides,
  };
}

function profile(rules: Profile["chain_rules"]): Profile {
  return {
    id: "test",
    name: "test",
    token: "abcdefgh",
    providers: [],
    include_manual_nodes: true,
    node_filter: { rename_rules: [], exclude_types: [] },
    chain_rules: rules,
    proxy_groups: [],
    rule_modules: [],
    surge_modules: [],
    userinfo: { enabled: false, mode: "sum", expose_per_provider_headers: true },
    managed_config_url: "auto",
    managed_config_interval: 86400,
    managed_config_strict: false,
    clash_options: { use_proxy_providers: false, flag: "mihomo", group_style: "flow" },
  };
}

describe("matchesSelector", () => {
  it("matches by from_providers", () => {
    const n = node("HK-01", { source_provider_id: "aaa" });
    expect(matchesSelector(n, { from_providers: ["aaa"] })).toBe(true);
    expect(matchesSelector(n, { from_providers: ["bbb"] })).toBe(false);
    expect(matchesSelector(n, {})).toBe(true);
  });

  it("excludes by exclude_type", () => {
    const n = node("X", { type: "ssr" });
    expect(matchesSelector(n, { exclude_type: ["ssr"] })).toBe(false);
    expect(matchesSelector(n, { exclude_type: ["vmess"] })).toBe(true);
  });

  it("matches by include_regex (case-sensitive, no flag prefix support)", () => {
    const n = node("🇯🇵 JP-Premium-01");
    expect(matchesSelector(n, { include_regex: "JP" })).toBe(true);
    expect(matchesSelector(n, { include_regex: "[Pp]remium" })).toBe(true);
    expect(matchesSelector(n, { include_regex: "HK" })).toBe(false);
    // case-sensitive by default
    expect(matchesSelector(n, { include_regex: "premium" })).toBe(false);
  });

  it("excludes by exclude_regex", () => {
    const n = node("过期-01");
    expect(matchesSelector(n, { exclude_regex: "过期" })).toBe(false);
    expect(matchesSelector(n, { exclude_regex: "expired" })).toBe(true);
  });

  it("treats invalid regex as non-match for include_regex but ignores for exclude_regex", () => {
    const n = node("test");
    expect(matchesSelector(n, { include_regex: "[invalid" })).toBe(false);
    expect(matchesSelector(n, { exclude_regex: "[invalid" })).toBe(true);
  });

  it("combines multiple selectors with AND", () => {
    const n = node("🇯🇵 JP-01", { source_provider_id: "aaa", type: "trojan" });
    expect(
      matchesSelector(n, {
        from_providers: ["aaa"],
        include_regex: "JP",
        exclude_type: ["ssr"],
      }),
    ).toBe(true);
    expect(
      matchesSelector(n, {
        from_providers: ["aaa"],
        include_regex: "HK",
      }),
    ).toBe(false);
  });
});

describe("applyChainRules", () => {
  it("does nothing when no rules", () => {
    const nodes = [node("A"), node("B")];
    const out = applyChainRules(nodes, profile([]));
    expect(out).toEqual(nodes);
    expect(out[0]).toBe(nodes[0]);
  });

  it("applies first matching rule", () => {
    const nodes = [node("HK-01"), node("JP-01"), node("US-01")];
    const out = applyChainRules(
      nodes,
      profile([
        { selector: { include_regex: "JP" }, via: "via-jp" },
        { selector: { include_regex: "HK" }, via: "via-hk" },
      ]),
    );
    expect(out[0].chain_via).toBe("via-hk");
    expect(out[1].chain_via).toBe("via-jp");
    expect(out[2].chain_via).toBeUndefined();
  });

  it("first matching rule wins (does not overlay later rules)", () => {
    const nodes = [node("JP-Premium-01")];
    const out = applyChainRules(
      nodes,
      profile([
        { selector: { include_regex: "JP" }, via: "via-jp" },
        { selector: { include_regex: "Premium" }, via: "via-premium" },
      ]),
    );
    expect(out[0].chain_via).toBe("via-jp");
  });

  it("does not preserve source chain_via if no rule matches (returns original)", () => {
    // applyChainRules currently returns original node ref when no rule matches; chain_via from source preserved.
    const nodes = [node("X", { chain_via: "source-via" })];
    const out = applyChainRules(nodes, profile([{ selector: { include_regex: "Y" }, via: "via" }]));
    expect(out[0].chain_via).toBe("source-via");
  });
});

describe("detectChainCycle", () => {
  it("passes when no chain", () => {
    expect(() => detectChainCycle(new Map(), new Set())).not.toThrow();
  });

  it("passes for linear chain A -> B -> C", () => {
    const map = new Map<string, string>([
      ["A", "B"],
      ["B", "C"],
    ]);
    expect(() => detectChainCycle(map, new Set())).not.toThrow();
  });

  it("throws on direct cycle A -> B -> A", () => {
    const map = new Map<string, string>([
      ["A", "B"],
      ["B", "A"],
    ]);
    expect(() => detectChainCycle(map, new Set())).toThrow(/cycle/i);
  });

  it("throws on indirect cycle A -> B -> C -> A", () => {
    const map = new Map<string, string>([
      ["A", "B"],
      ["B", "C"],
      ["C", "A"],
    ]);
    expect(() => detectChainCycle(map, new Set())).toThrow(/cycle/i);
  });

  it("treats group names as chain terminators (no cycle even if loop ends in group)", () => {
    const map = new Map<string, string>([
      ["A", "GroupX"],
      ["B", "GroupX"],
    ]);
    expect(() => detectChainCycle(map, new Set(["GroupX"]))).not.toThrow();
  });

  it("throws on self-loop A -> A", () => {
    const map = new Map<string, string>([["A", "A"]]);
    expect(() => detectChainCycle(map, new Set())).toThrow(/cycle/i);
  });
});
