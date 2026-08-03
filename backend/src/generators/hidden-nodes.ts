import { matchesSelector } from "../chain/apply.js";
import type { Node } from "../schemas/node.js";
import type { HiddenNodeSelector } from "../schemas/profile.js";

/**
 * profile.hidden_nodes 的最小结构。单独声明而不是直接用 zod 推断类型,
 * 是为了让测试/上层手写的 literal 也能传进来(与 ChainSelectorLike 同样的理由)。
 */
export type HiddenNodeSelectorLike = Partial<HiddenNodeSelector>;

/**
 * 所有条件都留空 → 不隐藏任何节点。
 *
 * 这一条与 chain / group selector 的"留空 = 匹配全部"刻意相反:hidden_nodes 有 schema
 * default,每个 profile 都会带着这个字段,若沿用"留空即全部"会让所有 profile 一升级就
 * 全节点隐藏、策略组集体空掉。
 */
export function isHiddenSelectorEmpty(selector?: HiddenNodeSelectorLike): boolean {
  if (!selector) return true;
  return (
    !selector.include_regex
    && !selector.exclude_regex
    && (selector.from_providers?.length ?? 0) === 0
    && (selector.include_region?.length ?? 0) === 0
    && (selector.include_type?.length ?? 0) === 0
    && (selector.exclude_type?.length ?? 0) === 0
    && (selector.include_nodes?.length ?? 0) === 0
  );
}

/**
 * 算出"仅供链式使用"的节点名集合:这些节点仍会写进 Clash `proxies:` / Surge `[Proxy]`
 * (所以 chain_via 指得到),但不参与任何策略组 selector 的动态匹配。
 *
 * 判定直接复用 chain/apply.ts 的 `matchesSelector` — 用户在链式规则作用域里学到的
 * 组合语义(`include_nodes` 与其余条件 AND、正则大小写不敏感、缺失属性按不匹配白名单处理)
 * 在这里完全一致,不用再学第二套。
 *
 * 调用时机:必须在节点改名之后(Clash 的 uniquify / Surge 的 escapeSurgeNames),
 * 否则 `include_nodes` 里用户点名的名字与最终产物里的名字对不上。
 */
export function resolveHiddenNodeNames(nodes: Node[], selector?: HiddenNodeSelectorLike): Set<string> {
  if (isHiddenSelectorEmpty(selector)) return new Set();
  const out = new Set<string>();
  for (const node of nodes) {
    if (matchesSelector(node, selector!)) out.add(node.name);
  }
  return out;
}
