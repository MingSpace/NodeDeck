import type { Node } from "../schemas/node.js";
import type { Profile } from "../schemas/profile.js";

/**
 * chain_rules 的作用域选择器(结构见 schemas/profile.ts chainSelectorSchema)。
 * 这里单独声明成 interface 而不是用 zod 推断类型,是为了让测试/上层手写的 literal 也能传进来。
 */
export interface ChainSelectorLike {
  include_regex?: string;
  exclude_regex?: string;
  /** @deprecated v1 遗留字段,chain 侧从未消费;`include_groups` 才是按组圈定的正确字段 */
  include_other_group?: string[];
  from_providers?: string[];
  include_type?: string[];
  exclude_type?: string[];
  include_region?: string[];
  include_nodes?: string[];
  include_groups?: string[];
}

export interface ChainRuleLike {
  enabled?: boolean;
  selector?: ChainSelectorLike;
  via: string;
  mode?: "override" | "fill";
  comment?: string;
}

export interface ChainContext {
  /**
   * 策略组名 → 该组包含的节点名集合,由 generators/group-members.ts 的 buildGroupMemberIndex 产出。
   * 不传时 `selector.include_groups` 无从判断成员,一律判为不匹配(而不是匹配全部)。
   */
  groupMembers?: Map<string, Set<string>>;
}

export const CHAIN_BUILTINS = new Set(["DIRECT", "REJECT"]);

function enabledRules(profile: Profile): ChainRuleLike[] {
  return (profile.chain_rules ?? []).filter((r) => r.enabled !== false);
}

/**
 * 把 Profile 的 chain_rules 应用到节点数组:每个节点由**第一条命中**的规则决定 chain_via。
 *
 * mode 语义:
 * - `override`(默认) — 命中即写入 rule.via,覆盖机场上游带来的 chain_via
 * - `fill`           — 节点已有 chain_via 时保持不动(仍算命中,不再往后找规则)
 *
 * 没有任何规则命中的节点保留其原有 chain_via(机场上游 dialer-proxy / underlying-proxy 透传)。
 */
export function applyChainRules(nodes: Node[], profile: Profile, ctx?: ChainContext): Node[] {
  const rules = enabledRules(profile);
  if (rules.length === 0) return nodes;
  return nodes.map((node) => {
    for (const rule of rules) {
      if (!matchesSelector(node, rule.selector ?? {}, ctx)) continue;
      if (rule.mode === "fill" && node.chain_via) return node;
      return { ...node, chain_via: rule.via };
    }
    return node;
  });
}

/**
 * 判断单个节点是否落在 selector 的作用域内。
 *
 * 组合语义:
 * - `include_groups` 与 `include_nodes` 之间是 **OR** — 两者任一非空时构成一个"显式作用域"条件,
 *   节点属于任一指定组、或名字在指定清单里,就算通过。这条对应用户视角的
 *   "某个策略组 **或** 指定节点走这条链",AND 会反直觉("既在清单里又在组里")。
 * - 其余条件(from_providers / include_type / exclude_type / include_region / 正则)彼此以及
 *   与显式作用域之间都是 **AND**。
 * - 全部留空 = 匹配所有节点。
 *
 * 缺失属性按"不匹配白名单"处理(node.region / source_provider_id 为 undefined 时,
 * 对应白名单非空即判否),与 group selector 的行为一致。
 */
export function matchesSelector(node: Node, selector: ChainSelectorLike, ctx?: ChainContext): boolean {
  const nodeScope = selector.include_nodes ?? [];
  const groupScope = selector.include_groups ?? [];
  if (nodeScope.length > 0 || groupScope.length > 0) {
    // 节点名是 Clash/Surge 的主键,精确比较、不做大小写折叠。
    const byNode = nodeScope.includes(node.name);
    const byGroup = !byNode && groupScope.some((g) => ctx?.groupMembers?.get(g)?.has(node.name) === true);
    if (!byNode && !byGroup) return false;
  }
  if (selector.from_providers && selector.from_providers.length > 0) {
    if (!node.source_provider_id || !selector.from_providers.includes(node.source_provider_id)) {
      return false;
    }
  }
  if (selector.include_type && selector.include_type.length > 0) {
    if (!selector.include_type.includes(node.type)) return false;
  }
  if (selector.exclude_type && selector.exclude_type.includes(node.type)) {
    return false;
  }
  // include_region 是白名单:非空时,node.region 必须命中;region 未识别(undefined)的节点也被排除,
  // 与 from_providers "source_provider_id 缺失则不匹配" 的语义一致。
  if (selector.include_region && selector.include_region.length > 0) {
    if (!node.region || !selector.include_region.includes(node.region)) {
      return false;
    }
  }
  // include/exclude_regex 默认大小写不敏感,与 node-filter.ts / group-members.ts 保持一致。
  if (selector.include_regex) {
    try {
      const re = new RegExp(selector.include_regex, "i");
      if (!re.test(node.name)) return false;
    } catch {
      // 非法 include 正则 => 判为不匹配。链式代理宁可不生效,也不能把整个节点池
      // 意外挂到某个前置上(group selector 取相反策略,详见 group-members.ts)。
      return false;
    }
  }
  if (selector.exclude_regex) {
    try {
      const re = new RegExp(selector.exclude_regex, "i");
      if (re.test(node.name)) return false;
    } catch {
      // 非法 exclude 正则 => 忽略该条件(排除项失效只会让作用域变大,不会误伤)
    }
  }
  return true;
}

export interface ChainRuleStat {
  /** 在 profile.chain_rules 中的下标 */
  index: number;
  enabled: boolean;
  via: string;
  mode: "override" | "fill";
  comment?: string;
  /** 满足 selector 的节点名(不论是否被更靠前的规则抢先决定) */
  matched: string[];
  /** 真正由本条规则写入 chain_via 的节点名 */
  effective: string[];
  /** mode=fill 且节点已自带 chain_via,因此被跳过(仍算本条命中)的节点名 */
  kept_existing: string[];
}

export interface ChainAnalysis {
  stats: ChainRuleStat[];
  /** 没有被任何启用规则命中的节点名 */
  unmatched: string[];
  /** 被多条规则同时命中的节点(rules 按下标升序,首个为实际生效的那条) */
  conflicts: { node: string; rules: number[] }[];
}

/**
 * 静态分析 chain_rules 的命中情况,供 Web UI 实时反馈用(不改动节点)。
 * 与 applyChainRules 共用 matchesSelector,保证"预览命中数"与订阅产物一致。
 */
export function analyzeChainRules(nodes: Node[], profile: Profile, ctx?: ChainContext): ChainAnalysis {
  const rules = profile.chain_rules ?? [];
  const stats: ChainRuleStat[] = rules.map((r, index) => ({
    index,
    enabled: r.enabled !== false,
    via: r.via,
    mode: r.mode ?? "override",
    comment: r.comment,
    matched: [],
    effective: [],
    kept_existing: [],
  }));
  const unmatched: string[] = [];
  const conflicts: { node: string; rules: number[] }[] = [];

  for (const node of nodes) {
    const hits: number[] = [];
    for (const stat of stats) {
      if (!stat.enabled) continue;
      const rule = rules[stat.index];
      if (!matchesSelector(node, rule.selector ?? {}, ctx)) continue;
      stat.matched.push(node.name);
      hits.push(stat.index);
    }
    if (hits.length === 0) {
      unmatched.push(node.name);
      continue;
    }
    if (hits.length > 1) conflicts.push({ node: node.name, rules: hits });
    const winner = stats.find((s) => s.index === hits[0])!;
    if (winner.mode === "fill" && node.chain_via) winner.kept_existing.push(node.name);
    else winner.effective.push(node.name);
  }

  return { stats, unmatched, conflicts };
}

export type ChainPathTerminal = "node" | "group" | "builtin" | "missing" | "cycle";

export interface ChainPath {
  /** 起点节点名 */
  node: string;
  /** [起点, 第一跳, 第二跳, ...],最后一项即出口 */
  path: string[];
  terminal: ChainPathTerminal;
}

/**
 * 展开每个带 chain_via 节点的完整链路,用于 UI 展示 `节点 → 前置A → 前置B` 这样的多跳路径。
 *
 * 多跳不是单条规则能表达的(Clash dialer-proxy / Surge underlying-proxy 都是单值);
 * 它由"前置本身也被某条规则挂上了 chain_via"自然形成,所以这里必须沿着图走一遍才能看到全貌。
 *
 * 调用时机应在 validateChain **之后** — 那时悬空与环都已清理,terminal 只会是
 * node / group / builtin;若在之前调用,missing / cycle 就是待修复的诊断。
 */
export function resolveChainPaths(nodes: Node[], options: { groupNames: Set<string> }): ChainPath[] {
  const viaOf = new Map<string, string>();
  for (const n of nodes) {
    if (n.chain_via) viaOf.set(n.name, n.chain_via);
  }
  const nodeNames = new Set(nodes.map((n) => n.name));
  const out: ChainPath[] = [];

  for (const n of nodes) {
    if (!n.chain_via) continue;
    const path = [n.name];
    const seen = new Set([n.name]);
    let cursor = n.chain_via;
    let terminal: ChainPathTerminal = "node";
    // guard:环已在上一步 validateChain 清理过,这里只是防御性上限。
    for (let depth = 0; depth <= nodes.length; depth++) {
      if (seen.has(cursor)) {
        path.push(cursor);
        terminal = "cycle";
        break;
      }
      path.push(cursor);
      seen.add(cursor);
      if (CHAIN_BUILTINS.has(cursor)) {
        terminal = "builtin";
        break;
      }
      if (options.groupNames.has(cursor)) {
        terminal = "group";
        break;
      }
      if (!nodeNames.has(cursor)) {
        terminal = "missing";
        break;
      }
      const next = viaOf.get(cursor);
      if (!next) {
        terminal = "node";
        break;
      }
      cursor = next;
    }
    out.push({ node: n.name, path, terminal });
  }
  return out;
}

/**
 * Detect cycles in chain proxy graph. Throws on cycle.
 * `nodeNameToVia` maps each node name to its chain_via target (node name or group name).
 * `groupNames` is the set of names that refer to groups (which are not nodes themselves).
 */
export function detectChainCycle(
  nodeNameToVia: Map<string, string>,
  groupNames: Set<string>,
): void {
  const visited = new Set<string>();
  const stack = new Set<string>();
  function dfs(name: string, path: string[]): void {
    if (groupNames.has(name)) return; // groups terminate the chain (each group selects one of its members at runtime)
    if (stack.has(name)) {
      throw new Error(`Chain proxy cycle detected: ${[...path, name].join(" -> ")}`);
    }
    if (visited.has(name)) return;
    stack.add(name);
    const next = nodeNameToVia.get(name);
    if (next) dfs(next, [...path, name]);
    stack.delete(name);
    visited.add(name);
  }
  for (const name of nodeNameToVia.keys()) {
    dfs(name, []);
  }
}

/**
 * 校验 + 归零所有节点的 chain_via 字段:
 * 1. 引用悬空(指向不存在的节点/组)→ 清空 + warning(降级为直接出口)
 * 2. 应用后形成环 → 把环上所有节点的 chain_via 清空 + warning
 *
 * 与 applyChainRules 的关系:这是 generator 的 *入口校验*,在 chain_rules 应用之后调用。
 * 之所以放在 generator 阶段而不是 schema 校验,是因为引用合法性依赖 *运行时* 的节点池
 * (机场拉取后才能知道有哪些节点名)。
 */
export function validateChain(
  nodes: Node[],
  options: { groupNames: Set<string>; warnings: string[] },
): Node[] {
  const { groupNames, warnings } = options;
  const nodeNames = new Set(nodes.map((n) => n.name));

  let cleaned: Node[] = nodes.map((n) => {
    if (!n.chain_via) return n;
    if (nodeNames.has(n.chain_via) || groupNames.has(n.chain_via) || CHAIN_BUILTINS.has(n.chain_via)) {
      return n;
    }
    warnings.push(
      `Chain dangling: node "${n.name}" chain_via "${n.chain_via}" not found, falling back to direct dial`,
    );
    const { chain_via: _omit, ...rest } = n;
    return rest as Node;
  });

  // DIRECT/REJECT 是合法终点,不计入 detectChainCycle 的"组"集合,但也不应视作节点;
  // detectChainCycle 把"非节点 = 终止"处理,所以把 builtins 加入 groupNames 子集合即可。
  const sinks = new Set([...groupNames, ...CHAIN_BUILTINS]);

  // 反复跑 detectChainCycle:每次发现一条环就把环上节点 chain_via 清掉,直到无环。
  // 防御性的最大循环次数 = 节点数,避免极端 case 死循环。
  for (let guard = 0; guard < cleaned.length + 1; guard++) {
    const nameToVia = new Map<string, string>();
    for (const n of cleaned) {
      if (n.chain_via) nameToVia.set(n.name, n.chain_via);
    }
    try {
      detectChainCycle(nameToVia, sinks);
      return cleaned;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const match = /Chain proxy cycle detected: (.+)$/.exec(msg);
      if (!match) {
        warnings.push(`Chain validation error: ${msg}`);
        return cleaned;
      }
      const cyclePath = match[1].split(" -> ").map((s) => s.trim());
      warnings.push(`Chain cycle detected: ${cyclePath.join(" -> ")}; chain_via cleared on all involved nodes`);
      const cycleSet = new Set(cyclePath);
      cleaned = cleaned.map((n) => {
        if (!cycleSet.has(n.name)) return n;
        const { chain_via: _omit, ...rest } = n;
        return rest as Node;
      });
    }
  }
  return cleaned;
}
