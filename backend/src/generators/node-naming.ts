import type { Node } from "../schemas/node.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { Provider } from "../schemas/provider.js";

/**
 * 计算每个 provider 的"来源标识"(用于同名节点改名时的 `【标识】` 前缀):
 * - 优先取第一个非空 tag 的完整文本(如 `【主力】`)
 * - 无 tag 时取 provider 名称首字符(ASCII 字母转大写,如 Kona → `【K】`)
 */
export function buildProviderLabels(providers: Provider[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const p of providers) {
    const tag = p.tags?.find((t) => t.trim().length > 0)?.trim();
    const label = tag ?? p.name.trim().charAt(0).toUpperCase();
    if (label) map.set(p.id, label);
  }
  return map;
}

export interface UniquifyOptions {
  /** provider id → 来源标识(见 buildProviderLabels);缺省时退化为纯 ` #2` 后缀策略 */
  providerLabels?: Map<string, string>;
  /** 一并改写引用的策略组(group.proxies / nested_groups / include_other_group) */
  groups?: ProxyGroup[];
}

/**
 * 在多机场节点池融合后,节点名很容易撞车(两家机场都叫 "🇭🇰 香港 01")。
 * Clash/Surge 都把节点名当作主键,重名会让客户端加载报错或行为未定义。
 *
 * 策略:撞名的所有节点统一加来源前缀 `【标识】`(标识由 buildProviderLabels 给出),
 * 如 `【K】Hong Kong 01` / `【主力】Hong Kong 01`,让用户在客户端一眼看出节点来源。
 * 节点无 source_provider_id / 查不到标识,或加前缀后仍撞名(同一机场内同名、
 * 两机场标识相同)时,回退追加 ` #2` / ` #3` 后缀兜底。
 *
 * 引用语义:renameMap 记「原名 → 该原名下所有节点的最终名列表(按节点池顺序)」。
 * - group.proxies 对原名的显式引用 **原位展开为全部同名节点**(用户在组里点了
 *   "Hong Kong 01",改名后 【K】/【奶】 两个都应出现在组里,缺一个等于"吃节点")
 * - node.chain_via(Clash dialer-proxy 只能填单个名)与 group.include_other_group /
 *   nested_groups(组名引用)是单值语义,取列表第一项,保持"原名指向第一个同名节点"
 *
 * 重命名信息记入 warnings,方便用户在订阅响应注释中看到。
 */
export function uniquifyNodeNames(
  nodes: Node[],
  warnings: string[],
  opts: UniquifyOptions = {},
): { nodes: Node[]; groups: ProxyGroup[] } {
  const counts = new Map<string, number>();
  for (const n of nodes) counts.set(n.name, (counts.get(n.name) ?? 0) + 1);

  const seen = new Set<string>();
  // 原名 → 所有同原名节点的最终名(按节点池顺序;含兜底路径下"第一个保留原名"的情况)
  const renameMap = new Map<string, string[]>();
  const out: Node[] = [];
  for (const n of nodes) {
    const conflict = (counts.get(n.name) ?? 0) > 1;
    const label = conflict && n.source_provider_id ? opts.providerLabels?.get(n.source_provider_id) : undefined;
    const base = label ? `【${label}】${n.name}` : n.name;

    let candidate = base;
    let suffix = 2;
    while (seen.has(candidate)) {
      candidate = `${base} #${suffix}`;
      suffix++;
    }
    seen.add(candidate);

    // 撞名组的每个成员都记入 renameMap(包括保留原名的第一个,展开引用时它也是成员);
    // 非撞名节点只在确实被改名时记(与已分配名撞车的 seen 兜底路径)。
    if (conflict || candidate !== n.name) {
      const finals = renameMap.get(n.name);
      if (finals) finals.push(candidate);
      else renameMap.set(n.name, [candidate]);
    }

    if (candidate === n.name) {
      out.push(n);
      continue;
    }
    const fromProvider = n.source_provider_id ? ` (from provider "${n.source_provider_id}")` : "";
    warnings.push(`Node name conflict: "${n.name}" renamed to "${candidate}"${fromProvider}`);
    out.push({ ...n, name: candidate });
  }

  const groups = opts.groups ?? [];
  if (renameMap.size === 0) return { nodes: out, groups };

  // 单值引用(chain_via / include_other_group / nested_groups)取第一个同名节点的最终名
  const remapSingle = (s: string | undefined): string | undefined =>
    s !== undefined ? renameMap.get(s)?.[0] ?? s : undefined;
  // group.proxies 显式引用按原名原位展开为全部同名节点,并去重(保留首次出现顺序)
  const expandRefs = (refs: string[]): string[] => {
    const dedup = new Set<string>();
    const expanded: string[] = [];
    for (const ref of refs) {
      for (const name of renameMap.get(ref) ?? [ref]) {
        if (!dedup.has(name)) {
          dedup.add(name);
          expanded.push(name);
        }
      }
    }
    return expanded;
  };

  const finalNodes = out.map((n) => {
    const newVia = remapSingle(n.chain_via);
    return newVia !== n.chain_via ? { ...n, chain_via: newVia } : n;
  });
  const finalGroups = groups.map((g) => {
    const newProxies = expandRefs(g.proxies);
    const newIncludeOther = remapSingle(g.include_other_group);
    const currentNested = g.nested_groups ?? [];
    const newNestedGroups = currentNested.map((p) => renameMap.get(p)?.[0] ?? p);
    const updated: ProxyGroup = { ...g };
    let touched = false;
    if (newProxies.length !== g.proxies.length || newProxies.some((p, i) => p !== g.proxies[i])) {
      updated.proxies = newProxies;
      touched = true;
    }
    if (newIncludeOther !== g.include_other_group) {
      updated.include_other_group = newIncludeOther;
      touched = true;
    }
    if (newNestedGroups.some((p, i) => p !== currentNested[i])) {
      updated.nested_groups = newNestedGroups;
      touched = true;
    }
    return touched ? updated : g;
  });

  return { nodes: finalNodes, groups: finalGroups };
}

/**
 * Surge 的节点/策略组名作为 INI 行的左侧标识符,不允许包含 `=` `,` `"` 等会破坏行解析的字符,
 * 也不允许首尾有空格。这里把这些字符替换为 `_`,并同步改写所有引用(node.chain_via,
 * group.proxies / group.nested_groups 中的成员/嵌套组引用,以及 group 的
 * include_other_group 字段)。
 *
 * 注意:本函数只在 Surge generator 入口调用;Clash 不需要(Clash 的 name 是 yaml 字符串,
 * 任意字符都安全)。
 */
export function escapeSurgeNames(
  nodes: Node[],
  groups: ProxyGroup[],
  warnings: string[],
): { nodes: Node[]; groups: ProxyGroup[] } {
  const renameMap = new Map<string, string>();
  const sanitize = (raw: string): string => raw.replace(/[=,"\r\n]/g, "_").trim();

  const cleanedNodes = nodes.map((n) => {
    const cleaned = sanitize(n.name);
    if (cleaned !== n.name) {
      renameMap.set(n.name, cleaned);
      warnings.push(`Surge name sanitize: node "${n.name}" → "${cleaned}" (illegal characters replaced)`);
    }
    return cleaned !== n.name ? { ...n, name: cleaned } : n;
  });
  const cleanedGroups = groups.map((g) => {
    const cleaned = sanitize(g.name);
    if (cleaned !== g.name) {
      renameMap.set(g.name, cleaned);
      warnings.push(`Surge name sanitize: group "${g.name}" → "${cleaned}" (illegal characters replaced)`);
    }
    return cleaned !== g.name ? { ...g, name: cleaned } : g;
  });

  if (renameMap.size === 0) return { nodes: cleanedNodes, groups: cleanedGroups };

  const remap = (s: string | undefined): string | undefined => (s !== undefined ? renameMap.get(s) ?? s : undefined);
  const finalNodes = cleanedNodes.map((n) => {
    const newVia = remap(n.chain_via);
    return newVia !== n.chain_via ? { ...n, chain_via: newVia } : n;
  });
  const finalGroups = cleanedGroups.map((g) => {
    const newProxies = g.proxies.map((p) => renameMap.get(p) ?? p);
    const newIncludeOther = remap(g.include_other_group);
    // `?? []` 是 defensive — 经 schema parse 的 group 一定有 nested_groups(default []),
    // 但测试里手动构造的 ProxyGroup literal 可能漏写。
    const currentNested = g.nested_groups ?? [];
    const newNestedGroups = currentNested.map((p) => renameMap.get(p) ?? p);
    const updated: ProxyGroup = { ...g };
    let touched = false;
    if (newProxies.some((p, i) => p !== g.proxies[i])) {
      updated.proxies = newProxies;
      touched = true;
    }
    if (newIncludeOther !== g.include_other_group) {
      updated.include_other_group = newIncludeOther;
      touched = true;
    }
    if (newNestedGroups.some((p, i) => p !== currentNested[i])) {
      updated.nested_groups = newNestedGroups;
      touched = true;
    }
    return touched ? updated : g;
  });

  return { nodes: finalNodes, groups: finalGroups };
}
