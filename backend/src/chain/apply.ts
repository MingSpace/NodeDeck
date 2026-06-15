import type { Node } from "../schemas/node.js";
import type { Profile } from "../schemas/profile.js";

/**
 * Apply a Profile's chain_rules to a node array.
 * For each node, the FIRST matching rule (by order in chain_rules) sets node.chain_via.
 * If a node already has chain_via from the source, it is preserved unless overridden by a matching rule.
 */
export function applyChainRules(nodes: Node[], profile: Profile): Node[] {
  if (!profile.chain_rules || profile.chain_rules.length === 0) return nodes;
  return nodes.map((node) => {
    for (const rule of profile.chain_rules) {
      if (matchesSelector(node, rule.selector)) {
        return { ...node, chain_via: rule.via };
      }
    }
    return node;
  });
}

interface SelectorLike {
  include_regex?: string;
  exclude_regex?: string;
  include_other_group?: string[];
  from_providers?: string[];
  exclude_type?: string[];
  include_region?: string[];
}

export function matchesSelector(node: Node, selector: SelectorLike): boolean {
  if (selector.from_providers && selector.from_providers.length > 0) {
    if (!node.source_provider_id || !selector.from_providers.includes(node.source_provider_id)) {
      return false;
    }
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
  // include/exclude_regex 默认大小写不敏感,与 node-filter.ts / clash.ts / surge.ts 保持一致。
  // 详见 node-filter.ts 上的注释。
  if (selector.include_regex) {
    try {
      const re = new RegExp(selector.include_regex, "i");
      if (!re.test(node.name)) return false;
    } catch {
      // invalid regex => non-match
      return false;
    }
  }
  if (selector.exclude_regex) {
    try {
      const re = new RegExp(selector.exclude_regex, "i");
      if (re.test(node.name)) return false;
    } catch {
      // ignore
    }
  }
  return true;
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

const CHAIN_BUILTINS = new Set(["DIRECT", "REJECT"]);

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
