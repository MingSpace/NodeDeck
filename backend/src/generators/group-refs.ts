import type { Node } from "../schemas/node.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";

/**
 * Clash / Surge 共有的内置 policy(可以直接出现在 group.proxies 中,运行时由客户端解析)。
 * - DIRECT / REJECT 两端都有
 * - REJECT-DROP / REJECT-NO-DROP / REJECT-TINYGIF 是 Surge 子类型,Clash 端会在
 *   downgradeClashPolicy 处映射为 REJECT;但保留在 group.proxies 中不会让 Clash 加载失败
 *   (Clash 把它当成一个不存在的代理名 → 实际客户端表现为 REJECT 的等价行为)
 * - PASS / COMPATIBLE 是 mihomo 专属,Surge 没有,但写在 Surge group 里只会被
 *   当成不存在的代理名,这里宁可保留(用户故意写)也不删
 */
const GROUP_BUILTIN_POLICIES: ReadonlySet<string> = new Set([
  "DIRECT",
  "REJECT",
  "REJECT-DROP",
  "REJECT-NO-DROP",
  "REJECT-TINYGIF",
  "PASS",
  "COMPATIBLE",
]);

/**
 * 校验 group.proxies 中的显式引用,把悬空节点名(既不在节点池、也不是组名、也不是内置 policy)
 * 剔除并推 warning。专门解决"用户在 node_filter 里 include/exclude 把节点过滤掉,
 * 但 group.proxies 显式列着的节点名仍指向那些被过滤掉的节点"导致客户端报 'proxy not found'。
 *
 * 与 validateChain 的关系:
 * - validateChain 处理 node.chain_via 的悬空 / 环
 * - validateGroupRefs 处理 group.proxies 的悬空
 * 都属于 generator 入口阶段 *运行时引用*的悬空清理(schema 层面无法校验,
 * 因为节点池要等 provider 拉取后才知道)
 *
 * 不动 selector 部分:selector.from_providers / include_regex 等已经基于 filteredNodes 计算,
 * 本身不会产生悬空引用。
 *
 * 不动 g.include_other_group / g.selector.include_other_group:
 * 这是组名引用,即使被引用的组里所有节点都被过滤光,组本身仍是合法的(Mihomo/Surge
 * 运行时会把空组当成 DIRECT 或报组级别 warning,但不会因引用方加载失败)。
 *
 * 同一个 (group, missing_name) 只 warn 一次。
 */
export function validateGroupRefs(
  groups: ProxyGroup[],
  nodes: Node[],
  options: { warnings: string[] },
): ProxyGroup[] {
  const { warnings } = options;
  const validNodeNames = new Set(nodes.map((n) => n.name));
  const groupNames = new Set(groups.map((g) => g.name));

  return groups.map((g) => {
    if (g.proxies.length === 0) return g;

    const kept: string[] = [];
    const dropped: string[] = [];
    const seen = new Set<string>();
    for (const ref of g.proxies) {
      if (
        validNodeNames.has(ref) ||
        groupNames.has(ref) ||
        GROUP_BUILTIN_POLICIES.has(ref)
      ) {
        kept.push(ref);
        continue;
      }
      if (seen.has(ref)) continue;
      seen.add(ref);
      dropped.push(ref);
    }

    if (dropped.length === 0) return g;

    warnings.push(
      `Proxy group "${g.name}" 引用了不存在的节点/组 [${dropped
        .map((s) => `"${s}"`)
        .join(", ")}](可能被 node_filter 过滤),已自动移除`,
    );
    return { ...g, proxies: kept };
  });
}
