// 策略组「最终成员」的前端预估口径。
// 与 backend/src/generators/group-members.ts 的 filterNodesBySelector /
// resolveGroupMemberEntries 保持同步 —— 那边是写进 yaml/conf 的唯一真相,这里只是拿
// /api/dashboard/node-pool 的全量节点做同样的推演,给列表页/编辑器显示数字。
//
// 与后端的已知差异(都是 profile 维度的信息,策略组模板本身无从得知):
//   - profile.hidden_nodes 会从 selector 动态匹配里剔除节点
//   - Clash use_proxy_providers 模式下,被 `use:` 引用的机场节点不进 proxies 列表
//   - Surge include-all-proxies / policy-regex-filter 由客户端自行展开
// 所以这里的 auto 数是「上限估算」,UI 文案不要写成绝对值。

export interface NodeSelectorLike {
  include_regex?: string;
  exclude_regex?: string;
  from_providers?: string[];
  exclude_type?: string[];
  include_region?: string[];
}

export interface PoolNodeLike {
  name: string;
  type: string;
  source_provider_id?: string;
  region?: string;
}

// 非法正则时忽略该条件(而不是判全不匹配),与后端 group-members.ts 的 compileRegex 一致:
// 组成员宁可多不可少,少了客户端会报 proxy not found。
function compileRegex(pattern: string): RegExp | null {
  try {
    return new RegExp(pattern, "i");
  } catch {
    return null;
  }
}

/**
 * 按 selector 的节点属性条件筛选节点池,各条件之间是 AND。
 * 顺序与后端 filterNodesBySelector 一致: from_providers → include_region → exclude_type
 * → include_regex → exclude_regex。
 */
export function filterNodesBySelector<T extends PoolNodeLike>(
  nodes: T[],
  selector: NodeSelectorLike,
): T[] {
  let pool = nodes;
  if (selector.from_providers && selector.from_providers.length > 0) {
    const allowed = new Set(selector.from_providers);
    pool = pool.filter((n) => n.source_provider_id !== undefined && allowed.has(n.source_provider_id));
  }
  if (selector.include_region && selector.include_region.length > 0) {
    // 白名单:region 未识别(undefined)的节点也排除,与后端一致。
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

export interface GroupLike {
  proxies?: string[];
  nested_groups?: string[];
  selector?: NodeSelectorLike;
  include_all_proxies?: boolean;
  policy_regex_filter?: string;
  include_other_group?: string;
}

export interface GroupComposition {
  /** g.proxies 显式锁定项(节点名 + 内置 policy),已按后端口径去重 */
  locked: number;
  /** g.nested_groups 嵌套引用的策略组数(不含已在 proxies 里重名的) */
  nested: number;
  /** selector 动态命中、且没被上面两段重复计入的节点数 */
  auto: number;
  /** 是否配了 selector 段 —— 没配就完全不做动态匹配(后端 `if (g.selector)`) */
  hasSelector: boolean;
  /** 写进产物的成员总数(= 后端 resolveGroupMemberEntries 的条目数) */
  total: number;
  /**
   * 成员由客户端侧展开、本地数不全:
   * Surge include-all-proxies / policy-regex-filter / include-other-group(平铺展开其它组成员)。
   */
  clientExpanded: boolean;
}

/**
 * 推演一个策略组的成员构成。去重口径与后端 resolveGroupMemberEntries 相同:
 * proxies → nested_groups → selector,重名以首次出现为准。
 */
export function summarizeGroupComposition(
  group: GroupLike,
  poolNodes: PoolNodeLike[],
): GroupComposition {
  const seen = new Set<string>();
  let locked = 0;
  let nested = 0;
  let auto = 0;

  for (const p of group.proxies ?? []) {
    if (seen.has(p)) continue;
    seen.add(p);
    locked++;
  }
  for (const g of group.nested_groups ?? []) {
    if (seen.has(g)) continue;
    seen.add(g);
    nested++;
  }
  const hasSelector = !!group.selector;
  if (group.selector) {
    for (const n of filterNodesBySelector(poolNodes, group.selector)) {
      if (seen.has(n.name)) continue;
      seen.add(n.name);
      auto++;
    }
  }

  return {
    locked,
    nested,
    auto,
    hasSelector,
    total: seen.size,
    clientExpanded:
      group.include_all_proxies === true ||
      !!group.policy_regex_filter ||
      !!group.include_other_group,
  };
}
