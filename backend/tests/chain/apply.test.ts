import { describe, expect, it } from "vitest";
import { applyChainRules, matchesSelector, detectChainCycle, validateChain } from "../../src/chain/apply.js";
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

  it("filters by include_region (whitelist)", () => {
    // include_region 是白名单:空 = 不过滤;非空 = 只保留 node.region 命中的节点;
    // region 未识别(undefined)的节点也排除 —— 与 from_providers 在 source_provider_id 缺失时不匹配的行为一致。
    const jp = node("JP-01", { region: "JP" });
    const us = node("US-01", { region: "US" });
    const unknown = node("???-01"); // 无 region
    expect(matchesSelector(jp, { include_region: [] })).toBe(true);
    expect(matchesSelector(jp, { include_region: ["JP"] })).toBe(true);
    expect(matchesSelector(jp, { include_region: ["JP", "HK"] })).toBe(true);
    expect(matchesSelector(us, { include_region: ["JP"] })).toBe(false);
    expect(matchesSelector(unknown, { include_region: ["JP"] })).toBe(false);
    expect(matchesSelector(unknown, { include_region: [] })).toBe(true);
  });

  it("matches by include_regex (case-insensitive by default)", () => {
    // include/exclude_regex 默认带 "i" flag,因为 JS RegExp 不支持 `(?i)` 这种 PCRE 内联标志,
    // 强制用户写字符类 `[Jj][Pp]` 反直觉;且机场命名大小写混乱,默认大小写不敏感更符合诉求。
    const n = node("🇯🇵 JP-Premium-01");
    expect(matchesSelector(n, { include_regex: "JP" })).toBe(true);
    expect(matchesSelector(n, { include_regex: "[Pp]remium" })).toBe(true);
    expect(matchesSelector(n, { include_regex: "HK" })).toBe(false);
    // 小写 / 混合大小写都能匹配
    expect(matchesSelector(n, { include_regex: "jp" })).toBe(true);
    expect(matchesSelector(n, { include_regex: "premium" })).toBe(true);
    expect(matchesSelector(n, { include_regex: "PREMIUM" })).toBe(true);
    // PCRE `(?i)` 在 JS RegExp 里语法非法,会被静默吞掉返回 false(invalid regex => non-match)
    expect(matchesSelector(n, { include_regex: "(?i)premium" })).toBe(false);
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

  it("preserves source chain_via if no rule matches (returns original node ref)", () => {
    // 节点本身带的 chain_via(机场原文里就有 dialer-proxy/underlying-proxy)在没有匹配规则时
    // 不应该被清掉,这是"chain_rules 是叠加而非覆盖"的设计。
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

describe("validateChain", () => {
  // 这是 generator 实际入口,detectChainCycle 是它内部的依赖。
  // 之所以单独再测,是因为 validateChain 还有"悬空降级"和"环修复"两层副作用,
  // 单纯依赖 protocol-matrix 的间接覆盖会漏掉环修复路径。
  it("不动 chain_via 指向真实节点的情况", () => {
    const nodes: Node[] = [node("A", { chain_via: "B" }), node("B")];
    const warnings: string[] = [];
    const out = validateChain(nodes, { groupNames: new Set(), warnings });
    expect(out[0].chain_via).toBe("B");
    expect(warnings).toEqual([]);
  });

  it("chain_via 指向 group 名也算合法终点", () => {
    const nodes: Node[] = [node("A", { chain_via: "MyGroup" })];
    const warnings: string[] = [];
    const out = validateChain(nodes, { groupNames: new Set(["MyGroup"]), warnings });
    expect(out[0].chain_via).toBe("MyGroup");
    expect(warnings).toEqual([]);
  });

  it("chain_via 指向 DIRECT/REJECT 内置策略也算合法终点", () => {
    const nodes: Node[] = [
      node("A", { chain_via: "DIRECT" }),
      node("B", { chain_via: "REJECT" }),
    ];
    const warnings: string[] = [];
    const out = validateChain(nodes, { groupNames: new Set(), warnings });
    expect(out[0].chain_via).toBe("DIRECT");
    expect(out[1].chain_via).toBe("REJECT");
    expect(warnings).toEqual([]);
  });

  it("chain_via 指向不存在的节点 → 清空 + warning(降级为直连)", () => {
    const nodes: Node[] = [node("A", { chain_via: "Ghost" })];
    const warnings: string[] = [];
    const out = validateChain(nodes, { groupNames: new Set(), warnings });
    expect(out[0].chain_via).toBeUndefined();
    expect(warnings.some((w) => w.includes("Chain dangling") && w.includes("Ghost"))).toBe(true);
  });

  it("形成环时 → 环上所有节点 chain_via 被清空 + warning", () => {
    // A → B → A
    const nodes: Node[] = [node("A", { chain_via: "B" }), node("B", { chain_via: "A" })];
    const warnings: string[] = [];
    const out = validateChain(nodes, { groupNames: new Set(), warnings });
    expect(out[0].chain_via).toBeUndefined();
    expect(out[1].chain_via).toBeUndefined();
    expect(warnings.some((w) => w.includes("Chain cycle"))).toBe(true);
  });

  it("自环 A → A 也按环处理,清空 + warning", () => {
    const nodes: Node[] = [node("A", { chain_via: "A" })];
    const warnings: string[] = [];
    const out = validateChain(nodes, { groupNames: new Set(), warnings });
    expect(out[0].chain_via).toBeUndefined();
    expect(warnings.some((w) => w.includes("Chain cycle"))).toBe(true);
  });

  it("多条独立环都能修复(迭代直到无环)", () => {
    // 第一组 A↔B,第二组 C↔D,两组互不相干,validateChain 应循环修完两组
    const nodes: Node[] = [
      node("A", { chain_via: "B" }),
      node("B", { chain_via: "A" }),
      node("C", { chain_via: "D" }),
      node("D", { chain_via: "C" }),
      node("E"), // 无关节点不动
    ];
    const warnings: string[] = [];
    const out = validateChain(nodes, { groupNames: new Set(), warnings });
    expect(out.find((n) => n.name === "A")?.chain_via).toBeUndefined();
    expect(out.find((n) => n.name === "B")?.chain_via).toBeUndefined();
    expect(out.find((n) => n.name === "C")?.chain_via).toBeUndefined();
    expect(out.find((n) => n.name === "D")?.chain_via).toBeUndefined();
    expect(out.find((n) => n.name === "E")?.chain_via).toBeUndefined();
    expect(warnings.filter((w) => w.includes("Chain cycle")).length).toBeGreaterThanOrEqual(2);
  });

  it("链 A → B → C(线性)不被误判为环", () => {
    const nodes: Node[] = [
      node("A", { chain_via: "B" }),
      node("B", { chain_via: "C" }),
      node("C"),
    ];
    const warnings: string[] = [];
    const out = validateChain(nodes, { groupNames: new Set(), warnings });
    expect(out[0].chain_via).toBe("B");
    expect(out[1].chain_via).toBe("C");
    expect(warnings).toEqual([]);
  });
});
