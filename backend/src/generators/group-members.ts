import type { Node } from "../schemas/node.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";

/**
 * group / chain selector 里"按节点属性筛选"那部分字段的最小结构。
 * 单独声明而不是直接用 zod 推断类型,是为了让测试里手写的 literal 也能传进来。
 */
export interface NodeSelectorLike {
  include_regex?: string;
  exclude_regex?: string;
  from_providers?: string[];
  exclude_type?: string[];
  include_region?: string[];
}

/**
 * selector.include/exclude_regex 默认大小写不敏感,与 node-filter.ts 保持一致。
 * 非法正则时**忽略该条件**(而不是全不匹配),沿用 v1 起 group selector 的行为:
 * 组成员宁可多不可少,少了会让客户端报 "proxy not found"。
 *
 * 注意 chain/apply.ts 的 matchesSelector 对非法 include_regex 取相反策略(判为不匹配) —
 * 链式代理宁可不生效也不能把全部节点意外挂到某个前置上。
 */
function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/** 按 selector 的节点属性条件筛选节点池;各条件之间是 AND,保持输入顺序。 */
export function filterNodesBySelector<T extends Node>(nodes: T[], selector: NodeSelectorLike): T[] {
  let pool = nodes.slice();
  if (selector.from_providers && selector.from_providers.length > 0) {
    const allowed = new Set(selector.from_providers);
    pool = pool.filter((n) => n.source_provider_id !== undefined && allowed.has(n.source_provider_id));
  }
  if (selector.include_region && selector.include_region.length > 0) {
    // 白名单:region 未识别(undefined)的节点也排除,与 from_providers 行为一致。
    const allowed = new Set(selector.include_region);
    pool = pool.filter((n) => n.region !== undefined && allowed.has(n.region));
  }
  if (selector.exclude_type && selector.exclude_type.length > 0) {
    const denied = new Set(selector.exclude_type);
    pool = pool.filter((n) => !denied.has(n.type));
  }
  if (selector.include_regex) {
    const re = compileRegex(selector.include_regex);
    if (re) pool = pool.filter((n) => re.test(n.name));
  }
  if (selector.exclude_regex) {
    const re = compileRegex(selector.exclude_regex);
    if (re) pool = pool.filter((n) => !re.test(n.name));
  }
  return pool;
}

/** 一个成员是从 group 的哪个字段来的 —— 决定它在成员列表里的位置,也是流转视图的分组依据。 */
export type GroupMemberOrigin = "explicit" | "other_group" | "nested" | "selector" | "fallback";

export interface GroupMemberEntry {
  name: string;
  origin: GroupMemberOrigin;
}

/**
 * 计算写进 yaml / conf 的**成员列表**(含内置 policy 与被嵌套引用的组名本身),并标注每项的来源。
 *
 * 这是 clash / surge 两端 generator 与 Web UI 流转视图的**唯一**成员顺序真相 —— 顺序对
 * `fallback` 组是语义的一部分(按声明顺序取第一个可用),所以三处必须同源,不能各写一份。
 *
 * 固定顺序:`proxies` → (Clash 才展开的 `include_other_group`) → `nested_groups` → selector 动态匹配。
 * 重名以**首次出现**的位置与来源为准(与原先 `new Set()` 的行为一致)。
 *
 * 与 `buildGroupMemberIndex` 的区别:那边递归展开成"真实节点名集合"给 chain 的 include_groups 用,
 * 这边不递归、保留组名本身,因为客户端就是这么消费的。
 */
export function resolveGroupMemberEntries(
  g: ProxyGroup,
  allNodes: Node[],
  options: {
    hiddenNodes?: Set<string>;
    /** Clash proxy-providers 模式:这些机场的节点由 `use:` 引用,不再进 proxies 列表 */
    excludeProviderIds?: Set<string>;
    /** include_other_group 是否展开为成员(Clash 无原生字段)还是保留为 params(Surge) */
    inlineIncludeOtherGroup: boolean;
    /** 成员为空时是否兜底塞一个 DIRECT */
    emptyFallback: boolean;
  },
): GroupMemberEntry[] {
  const seen = new Map<string, GroupMemberOrigin>();
  const push = (name: string, origin: GroupMemberOrigin) => {
    if (!seen.has(name)) seen.set(name, origin);
  };

  for (const p of g.proxies) push(p, "explicit");
  if (options.inlineIncludeOtherGroup && g.include_other_group) {
    push(g.include_other_group, "other_group");
  }
  // `?? []` 是 defensive — 经 schema parse 的 group 一定有这个字段(default []),
  // 但测试里手动构造的 ProxyGroup literal 可能漏写。
  for (const other of g.nested_groups ?? []) push(other, "nested");

  if (g.selector) {
    const exclude = options.excludeProviderIds;
    const base =
      exclude && exclude.size > 0
        ? allNodes.filter((n) => !n.source_provider_id || !exclude.has(n.source_provider_id))
        : allNodes;
    // 隐藏节点只挡 selector 动态匹配;上面 g.proxies 的显式点名是用户的明确意图,保留。
    const hidden = options.hiddenNodes;
    const selectable = hidden && hidden.size > 0 ? base.filter((n) => !hidden.has(n.name)) : base;
    for (const n of filterNodesBySelector(selectable, g.selector)) push(n.name, "selector");
  }

  if (seen.size === 0 && options.emptyFallback) push("DIRECT", "fallback");

  return [...seen].map(([name, origin]) => ({ name, origin }));
}

/**
 * 计算 "策略组名 → 该组最终包含的**节点名**集合"。
 *
 * 与 generator 里 resolveGroupMembers 的区别:那边产出的是写进 yaml/conf 的成员列表
 * (含内置 policy、含被嵌套引用的组名本身);这里只关心"哪些真实节点落在这个组里",
 * 用于 chain_rules 的 `selector.include_groups`。因此:
 * - 内置 policy(DIRECT / REJECT*)与不存在的引用一律丢弃
 * - `nested_groups` / `include_other_group` 递归展开成对方组的节点(组引用成环时断环)
 * - `proxies` 里若写的是组名(历史数据把组名混进显式列表)也按组引用展开
 *
 * `options.hiddenNodes`(profile.hidden_nodes 的解析结果)必须与两端 generator 的
 * resolveGroupMembers 用同一套口径:只从 selector 动态匹配里剔除,显式 `proxies` 点名保留。
 */
export function buildGroupMemberIndex(
  groups: ProxyGroup[],
  nodes: Node[],
  options?: { hiddenNodes?: Set<string> },
): Map<string, Set<string>> {
  const nodeNames = new Set(nodes.map((n) => n.name));
  const knownGroups = new Set(groups.map((g) => g.name));
  const hidden = options?.hiddenNodes;
  const selectable = hidden && hidden.size > 0 ? nodes.filter((n) => !hidden.has(n.name)) : nodes;

  const direct = new Map<string, { own: Set<string>; refs: string[] }>();
  for (const g of groups) {
    const own = new Set<string>();
    const refs: string[] = [];
    for (const p of g.proxies) {
      if (nodeNames.has(p)) own.add(p);
      else if (knownGroups.has(p)) refs.push(p);
    }
    if (g.selector) {
      for (const n of filterNodesBySelector(selectable, g.selector)) own.add(n.name);
    }
    // `?? []` 是 defensive — 经 schema parse 的 group 一定有这个字段(default []),
    // 但测试里手动构造的 ProxyGroup literal 可能漏写。
    for (const other of g.nested_groups ?? []) {
      if (knownGroups.has(other)) refs.push(other);
    }
    if (g.include_other_group && knownGroups.has(g.include_other_group)) {
      refs.push(g.include_other_group);
    }
    direct.set(g.name, { own, refs });
  }

  const resolved = new Map<string, Set<string>>();
  const visiting = new Set<string>();

  function resolve(name: string): Set<string> {
    const cached = resolved.get(name);
    if (cached) return cached;
    const entry = direct.get(name);
    if (!entry) return new Set();
    // 组引用成环(A 嵌套 B、B 又嵌套 A):在回边处只取该组自身成员,断环后继续。
    if (visiting.has(name)) return new Set(entry.own);
    visiting.add(name);
    const out = new Set(entry.own);
    for (const ref of entry.refs) {
      for (const n of resolve(ref)) out.add(n);
    }
    visiting.delete(name);
    resolved.set(name, out);
    return out;
  }

  for (const g of groups) resolve(g.name);
  return resolved;
}
