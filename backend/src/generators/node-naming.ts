import type { Node } from "../schemas/node.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { Provider } from "../schemas/provider.js";

const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/**
 * 从 provider 名推导「短 / 长」两档候选标识(1 字 / 2 字),推不出来返回 null。
 * - 中日韩名:取前 1 / 2 个字(`奶昔云` → 奶 / 奶昔)
 * - 拉丁名:首字母大写;两字档多词取词首(`Just My Socks` / `JustMySocks` → JM),单词取前两个字母(`Kona` → Ko)
 * emoji / 标点 / 空格一律跳过,不参与取字。
 */
function deriveLabelCandidates(name: string): { short: string; long: string } | null {
  const chars = [...name.normalize("NFKC")].filter((c) => /[\p{L}\p{N}]/u.test(c));
  if (chars.length === 0) return null;
  const first = chars[0];
  if (CJK_CHAR.test(first)) {
    return { short: first, long: chars.slice(0, 2).join("") };
  }
  const short = first.toUpperCase();
  const words = name
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+|(?<=\p{Ll})(?=\p{Lu})/u)
    .filter((w) => w.length > 0);
  const long =
    words.length >= 2
      ? (words[0].charAt(0) + words[1].charAt(0)).toUpperCase()
      : short + (chars[1] ?? "").toLowerCase();
  return { short, long };
}

/**
 * 计算每个 provider 的"来源标识"(节点名前缀 `【标识】` 里的那 1~2 个字):
 * - provider 显式填了 `name_prefix` → 原样使用(用户说了算,撞了也不改,由 uniquify 的 ` #2` 兜底)
 * - 否则从名称自动取字:优先 1 个字;与其它 provider 撞了就**撞的双方都**升到 2 个字
 *   (`Kona` / `Kuro` → Ko / Ku,而不是 K / Ku —— 不让"谁排在前面"决定谁拿到短名);
 *   2 个字仍撞再追加数字(Ko / Ko2)
 * - 名称里取不出字(纯 emoji / 标点)→ 退化为 id 首字母
 *
 * 只在传入的 providers 范围内消歧,调用方要保证各处传的是同一批(profile 中启用的 provider,
 * 按 profile.providers 顺序),否则同一个机场在主订阅与预览里可能拿到不同的标识。
 */
export function buildProviderLabels(providers: Provider[]): Map<string, string> {
  const map = new Map<string, string>();
  const taken = new Set<string>();
  const auto: { id: string; short: string; long: string }[] = [];
  for (const p of providers) {
    const explicit = p.name_prefix?.trim();
    if (explicit) {
      map.set(p.id, explicit);
      taken.add(explicit);
      continue;
    }
    const cand = deriveLabelCandidates(p.name) ?? deriveLabelCandidates(p.id);
    if (cand) auto.push({ id: p.id, ...cand });
  }

  const shortCounts = new Map<string, number>();
  for (const a of auto) shortCounts.set(a.short, (shortCounts.get(a.short) ?? 0) + 1);

  for (const a of auto) {
    let label = shortCounts.get(a.short) === 1 && !taken.has(a.short) ? a.short : a.long;
    if (taken.has(label)) {
      let n = 2;
      while (taken.has(`${label}${n}`)) n++;
      label = `${label}${n}`;
    }
    taken.add(label);
    map.set(a.id, label);
  }
  return map;
}

/**
 * 节点名正则匹配:改名后的名字与改名前的 `unprefixed_name` 任一命中即算。
 * 用户的 selector 正则多半按机场原名写(`^🇭🇰`),也可能故意按前缀圈机场(`^【K】`),两种都要认。
 */
export function testNodeName(re: RegExp, node: Pick<Node, "name" | "unprefixed_name">): boolean {
  return re.test(node.name) || (node.unprefixed_name !== undefined && re.test(node.unprefixed_name));
}

/** 精确点名(include_nodes)同理:最终名或改名前的名字都算。 */
export function nodeNameIn(names: readonly string[], node: Pick<Node, "name" | "unprefixed_name">): boolean {
  return names.includes(node.name) || (node.unprefixed_name !== undefined && names.includes(node.unprefixed_name));
}

/**
 * 把「按节点名的单值引用」(chain_rules.via)解析到最终名:先认最终名与 `keep`(组名),
 * 再认改名前的名字(多个同原名节点取第一个,与 uniquify 对 chain_via 的单值语义一致),
 * 都不是就原样返回(DIRECT / 悬空引用,交给 validateChain 判)。
 */
export function buildNodeRefResolver(nodes: Node[], keep?: { has(name: string): boolean }): (ref: string) => string {
  const finals = new Set(nodes.map((n) => n.name));
  const byOriginal = new Map<string, string>();
  for (const n of nodes) {
    if (n.unprefixed_name !== undefined && !byOriginal.has(n.unprefixed_name)) {
      byOriginal.set(n.unprefixed_name, n.name);
    }
  }
  return (ref) => (finals.has(ref) || keep?.has(ref) ? ref : byOriginal.get(ref) ?? ref);
}

export interface UniquifyOptions {
  /** provider id → 来源标识(见 buildProviderLabels);缺省时退化为纯 ` #2` 后缀策略 */
  providerLabels?: Map<string, string>;
  /** 一并改写引用的策略组(group.proxies / nested_groups / include_other_group) */
  groups?: ProxyGroup[];
  /**
   * true = 所有带来源的节点都加 `【标识】` 前缀(profile.node_filter.source_prefix === "always");
   * false / 缺省 = 只给撞名节点加。
   */
  prefixAll?: boolean;
}

/**
 * 在多机场节点池融合后,节点名很容易撞车(两家机场都叫 "🇭🇰 香港 01")。
 * Clash/Surge 都把节点名当作主键,重名会让客户端加载报错或行为未定义。
 *
 * 策略:撞名的所有节点统一加来源前缀 `【标识】`(标识由 buildProviderLabels 给出),
 * 如 `【K】Hong Kong 01` / `【奶】Hong Kong 01`,让用户在客户端一眼看出节点来源;
 * `prefixAll` 打开时不论撞没撞名,所有带来源的节点都加。
 * 节点无 source_provider_id / 查不到标识,或加前缀后仍撞名(同一机场内同名、
 * 两机场标识相同)时,回退追加 ` #2` / ` #3` 后缀兜底。
 *
 * 引用语义:renameMap 记「原名 → 该原名下所有节点的最终名列表(按节点池顺序)」。
 * - group.proxies 对原名的显式引用 **原位展开为全部同名节点**(用户在组里点了
 *   "Hong Kong 01",改名后 【K】/【奶】 两个都应出现在组里,缺一个等于"吃节点")
 * - node.chain_via(Clash dialer-proxy 只能填单个名)与 group.include_other_group /
 *   nested_groups / underlying_proxy(组名引用)是单值语义,取列表第一项,
 *   保持"原名指向第一个同名节点"
 *
 * 被改名的节点记下 `unprefixed_name`(改名前的名字):selector 的正则 / include_nodes、
 * chain_rules 的 via 都会兼认这个名字,用户写的 `^🇭🇰` 之类锚定正则不会因为加了前缀失效。
 *
 * 重命名信息记入 warnings,方便用户在订阅响应注释中看到。prefixAll 下的统一加前缀是用户
 * 主动要的,不记 warning(否则几百条噪音会刷满响应头、触发告警),只记 ` #2` 兜底这类意外改名。
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
    const wantPrefix = conflict || opts.prefixAll === true;
    const label = wantPrefix && n.source_provider_id ? opts.providerLabels?.get(n.source_provider_id) : undefined;
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
    if (!opts.prefixAll || candidate !== base) {
      const fromProvider = n.source_provider_id ? ` (from provider "${n.source_provider_id}")` : "";
      warnings.push(`Node name conflict: "${n.name}" renamed to "${candidate}"${fromProvider}`);
    }
    out.push({ ...n, name: candidate, unprefixed_name: n.unprefixed_name ?? n.name });
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
    const newUnderlying = remapSingle(g.underlying_proxy);
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
    if (newUnderlying !== g.underlying_proxy) {
      updated.underlying_proxy = newUnderlying;
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
 * include_other_group 与 underlying_proxy 字段)。
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
    const newUnderlying = remap(g.underlying_proxy);
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
    if (newUnderlying !== g.underlying_proxy) {
      updated.underlying_proxy = newUnderlying;
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
