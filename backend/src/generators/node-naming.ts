import type { Node } from "../schemas/node.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";

/**
 * 在多机场节点池融合后,节点名很容易撞车(两家机场都叫 "🇭🇰 香港 01")。
 * Clash/Surge 都把节点名当作主键,重名会让客户端加载报错或行为未定义。
 *
 * 策略:第一个出现的节点保留原名;后续重名按出现顺序追加 ` #2` / ` #3` 后缀。
 *
 * 注意我们故意 *不* 改写 chain_via / proxy_groups.proxies 中的引用:
 * - 原名永远指向"第一个"同名节点(被保留原名的那个),引用语义稳定
 * - chain_via 指向被改名节点(意图模糊)的场景,由 chain validation 阶段处理
 *
 * 重命名信息记入 warnings,方便用户在订阅响应注释中看到。
 */
export function uniquifyNodeNames(nodes: Node[], warnings: string[]): Node[] {
  const seen = new Set<string>();
  const out: Node[] = [];
  for (const n of nodes) {
    if (!seen.has(n.name)) {
      seen.add(n.name);
      out.push(n);
      continue;
    }
    let suffix = 2;
    let candidate = `${n.name} #${suffix}`;
    while (seen.has(candidate)) {
      suffix++;
      candidate = `${n.name} #${suffix}`;
    }
    seen.add(candidate);
    const fromProvider = n.source_provider_id ? ` (from provider "${n.source_provider_id}")` : "";
    warnings.push(`Node name conflict: "${n.name}" renamed to "${candidate}"${fromProvider}`);
    out.push({ ...n, name: candidate });
  }
  return out;
}

/**
 * Surge 的节点/策略组名作为 INI 行的左侧标识符,不允许包含 `=` `,` `"` 等会破坏行解析的字符,
 * 也不允许首尾有空格。这里把这些字符替换为 `_`,并同步改写所有引用(node.chain_via,
 * group.proxies 中的成员引用,以及 group 的 include_other_group 字段)。
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
    const newSelectorOther = g.selector?.include_other_group?.map((p) => renameMap.get(p) ?? p);
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
    if (g.selector && newSelectorOther && newSelectorOther.some((p, i) => p !== g.selector!.include_other_group[i])) {
      updated.selector = { ...g.selector, include_other_group: newSelectorOther };
      touched = true;
    }
    return touched ? updated : g;
  });

  return { nodes: finalNodes, groups: finalGroups };
}
