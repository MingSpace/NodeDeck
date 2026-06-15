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

const PREVIEW_LIMIT = 5;

function formatNameList(names: string[]): string {
  if (names.length <= PREVIEW_LIMIT) {
    return names.map((s) => `"${s}"`).join(", ");
  }
  const head = names
    .slice(0, PREVIEW_LIMIT)
    .map((s) => `"${s}"`)
    .join(", ");
  return `${head} 和另外 ${names.length - PREVIEW_LIMIT} 个`;
}

/**
 * 校验 group.proxies 中的显式引用,把悬空引用(既不在节点池、不是当前启用的组名、也不是内置 policy)
 * 剔除并推 warning。专门解决"用户在 node_filter 里 include/exclude 把节点过滤掉,
 * 但 group.proxies 显式列着的节点名仍指向那些被过滤掉的节点"导致客户端报 'proxy not found'。
 *
 * 与 validateChain 的关系:
 * - validateChain 处理 node.chain_via 的悬空 / 环
 * - validateGroupRefs 处理 group.proxies 的悬空
 * 都属于 generator 入口阶段 *运行时引用* 的悬空清理(schema 层面无法校验,
 * 因为节点池要等 provider 拉取后才知道)
 *
 * 区分两类诊断(对应 AGENTS.md 中描述的两种典型用户错配):
 * 1. **nodeDangling** - 该引用名既不是节点、也不是已知的组(无论是否启用):
 *    - 节点池**全空**:聚合成 1 条总览 warning(节点池空意味着所有 group 的节点引用必然悬空,
 *      per-group 重复 warning 噪音太大,大概率根因是 provider 拉取失败或 node_filter 过激)
 *    - 节点池**非空**:per-group warning,列前 5 个 + "和另外 X 个"(更可能是个别节点被过滤,
 *      用户需要知道是哪些)
 * 2. **notImported** - 该名字在系统的 group yaml 中存在,但当前 profile.proxy_groups 没把它启用:
 *    - 单独 per-group warning,文案明确指引到 Profile 编辑器加进来,避免用户被"是被过滤的节点"
 *      错误诊断误导而去翻 node_filter
 *
 * 不动 selector 部分:selector.from_providers / include_regex 等已经基于 filteredNodes 计算,
 * 本身不会产生悬空引用。
 *
 * 不动 g.include_other_group / g.nested_groups:
 * 这是组名引用,即使被引用的组里所有节点都被过滤光,组本身仍是合法的(Mihomo/Surge
 * 运行时会把空组当成 DIRECT 或报组级别 warning,但不会因引用方加载失败)。
 * 老字段 g.selector.include_other_group 已被 schema transform 迁移到 g.nested_groups,
 * 这里也不再考虑它。
 *
 * 同一个 (group, missing_name) 只 warn 一次。
 *
 * @param allKnownGroupNames 系统中所有 group 的 name 集合(详见 ResolvedProfile.allKnownGroupNames);
 *                           不传则退化为"所有未知引用都归入 nodeDangling"。
 */
export function validateGroupRefs(
  groups: ProxyGroup[],
  nodes: Node[],
  options: { warnings: string[]; allKnownGroupNames?: Set<string> },
): ProxyGroup[] {
  const { warnings, allKnownGroupNames } = options;
  const validNodeNames = new Set(nodes.map((n) => n.name));
  const activeGroupNames = new Set(groups.map((g) => g.name));
  // 不传 allKnownGroupNames 时,把"已启用组名集合"当作"已知组名集合",
  // 此时所有未知名都被归类为 nodeDangling(旧行为)。
  const knownGroupNames = allKnownGroupNames ?? activeGroupNames;
  const nodePoolEmpty = nodes.length === 0;

  // per-group 收集 dangling 引用,等遍历完所有 group 再统一决定如何输出 warning
  // (因为节点池全空时要聚合 → 单条总览;否则 → per-group 分散)
  const perGroupNodeDangling: { group: string; refs: string[] }[] = [];

  const sanitized = groups.map((g) => {
    if (g.proxies.length === 0) return g;

    const kept: string[] = [];
    const droppedNodes: string[] = [];
    const droppedNotImported: string[] = [];
    const seen = new Set<string>();

    for (const ref of g.proxies) {
      if (
        validNodeNames.has(ref) ||
        activeGroupNames.has(ref) ||
        GROUP_BUILTIN_POLICIES.has(ref)
      ) {
        kept.push(ref);
        continue;
      }
      if (seen.has(ref)) continue;
      seen.add(ref);

      // 优先判断 notImported:系统里有这个 group yaml,只是没在当前 profile 启用
      if (knownGroupNames.has(ref)) {
        droppedNotImported.push(ref);
      } else {
        droppedNodes.push(ref);
      }
    }

    if (droppedNodes.length === 0 && droppedNotImported.length === 0) return g;

    if (droppedNotImported.length > 0) {
      warnings.push(
        `Proxy group "${g.name}" 引用了已存在但未在当前 Profile 启用的组 [${formatNameList(
          droppedNotImported,
        )}],已自动移除;请到 Profile 编辑器把这些组加入 proxy_groups 列表以恢复引用`,
      );
    }
    if (droppedNodes.length > 0) {
      perGroupNodeDangling.push({ group: g.name, refs: droppedNodes });
    }
    return { ...g, proxies: kept };
  });

  if (perGroupNodeDangling.length > 0) {
    if (nodePoolEmpty) {
      const total = perGroupNodeDangling.reduce((sum, item) => sum + item.refs.length, 0);
      const groupCount = perGroupNodeDangling.length;
      warnings.push(
        `节点池为空,所有 group.proxies 中的节点引用共 ${total} 处(分布于 ${groupCount} 个组)已统一移除;请检查 provider 拉取状态或 node_filter 是否过激`,
      );
    } else {
      for (const item of perGroupNodeDangling) {
        warnings.push(
          `Proxy group "${item.group}" 移除了 ${item.refs.length} 个被 node_filter 过滤(或不存在)的节点引用: [${formatNameList(
            item.refs,
          )}]`,
        );
      }
    }
  }

  return sanitized;
}
