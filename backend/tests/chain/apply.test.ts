import { describe, expect, it } from "vitest";
import {
  analyzeChainRules,
  applyChainRules,
  matchesSelector,
  detectChainCycle,
  resolveChainPaths,
  validateChain,
} from "../../src/chain/apply.js";
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
    node_filter: { rename_rules: [], exclude_types: [], sort_by_region: false },
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

  it("filters by include_type (whitelist, symmetric to exclude_type)", () => {
    const n = node("X", { type: "trojan" });
    expect(matchesSelector(n, { include_type: [] })).toBe(true);
    expect(matchesSelector(n, { include_type: ["trojan"] })).toBe(true);
    expect(matchesSelector(n, { include_type: ["vmess", "ss"] })).toBe(false);
    // include_type 与 exclude_type 同时命中时,排除优先(AND 组合下任一为否即否)
    expect(matchesSelector(n, { include_type: ["trojan"], exclude_type: ["trojan"] })).toBe(false);
  });

  it("matches by include_nodes with exact, case-sensitive node names", () => {
    const n = node("🇭🇰 HK-01");
    expect(matchesSelector(n, { include_nodes: ["🇭🇰 HK-01"] })).toBe(true);
    expect(matchesSelector(n, { include_nodes: ["other", "🇭🇰 HK-01"] })).toBe(true);
    expect(matchesSelector(n, { include_nodes: ["HK-01"] })).toBe(false);
    // 节点名是 Clash/Surge 的主键,精确匹配不做大小写折叠(与 include_regex 相反)
    expect(matchesSelector(n, { include_nodes: ["🇭🇰 hk-01"] })).toBe(false);
  });

  it("matches by include_groups through the group member index", () => {
    const groupMembers = new Map([
      ["AI", new Set(["HK-01", "JP-01"])],
      ["Stream", new Set(["US-01"])],
    ]);
    const ctx = { groupMembers };
    expect(matchesSelector(node("HK-01"), { include_groups: ["AI"] }, ctx)).toBe(true);
    expect(matchesSelector(node("US-01"), { include_groups: ["AI"] }, ctx)).toBe(false);
    expect(matchesSelector(node("US-01"), { include_groups: ["AI", "Stream"] }, ctx)).toBe(true);
    // 组名不存在于索引里
    expect(matchesSelector(node("HK-01"), { include_groups: ["Ghost"] }, ctx)).toBe(false);
    // 没有传 ctx 时无从判断成员,一律不匹配(而不是匹配全部)
    expect(matchesSelector(node("HK-01"), { include_groups: ["AI"] })).toBe(false);
  });

  it("treats include_groups / include_nodes as OR, and ANDs them with the rest", () => {
    const ctx = { groupMembers: new Map([["AI", new Set(["HK-01"])]]) };
    // 用户视角:"AI 组的节点 *或* 我点名的 JP-01"
    const scope = { include_groups: ["AI"], include_nodes: ["JP-01"] };
    expect(matchesSelector(node("HK-01"), scope, ctx)).toBe(true);
    expect(matchesSelector(node("JP-01"), scope, ctx)).toBe(true);
    expect(matchesSelector(node("US-01"), scope, ctx)).toBe(false);
    // 其余条件仍是 AND:HK-01 在 AI 组里,但协议被排掉
    expect(
      matchesSelector(node("HK-01", { type: "ssr" }), { ...scope, exclude_type: ["ssr"] }, ctx),
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

  it("skips disabled rules", () => {
    const nodes = [node("HK-01")];
    const out = applyChainRules(
      nodes,
      profile([
        { enabled: false, selector: { include_regex: "HK" }, via: "via-off" },
        { selector: { include_regex: "HK" }, via: "via-on" },
      ]),
    );
    expect(out[0].chain_via).toBe("via-on");
  });

  it("mode=override replaces the node's own chain_via, mode=fill keeps it", () => {
    const nodes = [node("A", { chain_via: "source-via" }), node("B")];
    const overridden = applyChainRules(nodes, profile([{ via: "rule-via", mode: "override" }]));
    expect(overridden[0].chain_via).toBe("rule-via");
    expect(overridden[1].chain_via).toBe("rule-via");

    const filled = applyChainRules(nodes, profile([{ via: "rule-via", mode: "fill" }]));
    expect(filled[0].chain_via).toBe("source-via");
    expect(filled[1].chain_via).toBe("rule-via");
  });

  it("mode=fill still consumes the match (later rules do not get a second shot)", () => {
    const nodes = [node("A", { chain_via: "source-via" })];
    const out = applyChainRules(
      nodes,
      profile([
        { via: "fill-via", mode: "fill" },
        { via: "override-via", mode: "override" },
      ]),
    );
    expect(out[0].chain_via).toBe("source-via");
  });

  it("routes nodes to different chains per group", () => {
    // 用户的核心诉求:AI 组走 WARP 落地,Stream 组走 JP 跳板,其余不挂链。
    const nodes = [node("HK-01"), node("HK-02"), node("US-01")];
    const ctx = {
      groupMembers: new Map([
        ["AI", new Set(["HK-01"])],
        ["Stream", new Set(["HK-02"])],
      ]),
    };
    const out = applyChainRules(
      nodes,
      profile([
        { selector: { include_groups: ["AI"] }, via: "WARP" },
        { selector: { include_groups: ["Stream"] }, via: "JP-DIP" },
      ]),
      ctx,
    );
    expect(out[0].chain_via).toBe("WARP");
    expect(out[1].chain_via).toBe("JP-DIP");
    expect(out[2].chain_via).toBeUndefined();
  });
});

describe("analyzeChainRules", () => {
  it("reports matched / effective counts, conflicts and unmatched nodes", () => {
    const nodes = [node("JP-Premium-01"), node("JP-02"), node("US-01")];
    const analysis = analyzeChainRules(
      nodes,
      profile([
        { selector: { include_regex: "JP" }, via: "via-jp" },
        { selector: { include_regex: "Premium" }, via: "via-premium" },
      ]),
    );
    expect(analysis.stats[0].matched).toEqual(["JP-Premium-01", "JP-02"]);
    expect(analysis.stats[0].effective).toEqual(["JP-Premium-01", "JP-02"]);
    // 第二条也"命中"了 JP-Premium-01,但被第一条抢先,effective 为空 → UI 据此提示规则被遮蔽
    expect(analysis.stats[1].matched).toEqual(["JP-Premium-01"]);
    expect(analysis.stats[1].effective).toEqual([]);
    expect(analysis.conflicts).toEqual([{ node: "JP-Premium-01", rules: [0, 1] }]);
    expect(analysis.unmatched).toEqual(["US-01"]);
  });

  it("keeps disabled rules in the stats but never counts hits for them", () => {
    const analysis = analyzeChainRules(
      [node("HK-01")],
      profile([{ enabled: false, selector: {}, via: "via" }]),
    );
    expect(analysis.stats[0].enabled).toBe(false);
    expect(analysis.stats[0].matched).toEqual([]);
    expect(analysis.unmatched).toEqual(["HK-01"]);
  });

  it("separates mode=fill nodes that kept their own chain_via", () => {
    const analysis = analyzeChainRules(
      [node("A", { chain_via: "source-via" }), node("B")],
      profile([{ via: "rule-via", mode: "fill" }]),
    );
    expect(analysis.stats[0].kept_existing).toEqual(["A"]);
    expect(analysis.stats[0].effective).toEqual(["B"]);
  });
});

describe("resolveChainPaths", () => {
  it("expands a multi-hop chain into the full path", () => {
    // 多跳靠"前置本身也挂了 chain_via"形成:A → B → C,C 是最终出口
    const nodes: Node[] = [
      node("A", { chain_via: "B" }),
      node("B", { chain_via: "C" }),
      node("C"),
    ];
    const paths = resolveChainPaths(nodes, { groupNames: new Set() });
    expect(paths).toEqual([
      { node: "A", path: ["A", "B", "C"], terminal: "node" },
      { node: "B", path: ["B", "C"], terminal: "node" },
    ]);
  });

  it("marks group / builtin / missing terminals", () => {
    const nodes: Node[] = [
      node("A", { chain_via: "MyGroup" }),
      node("B", { chain_via: "DIRECT" }),
      node("C", { chain_via: "Ghost" }),
    ];
    const paths = resolveChainPaths(nodes, { groupNames: new Set(["MyGroup"]) });
    expect(paths.map((p) => p.terminal)).toEqual(["group", "builtin", "missing"]);
  });

  it("marks cycles instead of looping forever", () => {
    // validateChain 正常会先把环清掉;这里断言"万一在它之前调用"也不会挂
    const nodes: Node[] = [node("A", { chain_via: "B" }), node("B", { chain_via: "A" })];
    const paths = resolveChainPaths(nodes, { groupNames: new Set() });
    expect(paths.every((p) => p.terminal === "cycle")).toBe(true);
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
