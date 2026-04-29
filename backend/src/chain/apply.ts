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
  if (selector.include_regex) {
    try {
      const re = new RegExp(selector.include_regex);
      if (!re.test(node.name)) return false;
    } catch {
      // invalid regex => non-match
      return false;
    }
  }
  if (selector.exclude_regex) {
    try {
      const re = new RegExp(selector.exclude_regex);
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
