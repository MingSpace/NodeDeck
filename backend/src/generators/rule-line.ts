/**
 * inline payload 行(不带策略)→ [Rule] / rules: 整行(带策略)的转换。
 *
 * 规则行的语法是 `TYPE,VALUE,POLICY[,option...]`,策略必须紧跟在 VALUE 之后
 * (manual.nssurge.com/rules/overview.html#composition)。而 ruleset 文件 /
 * `[Ruleset]` 段内的行是不带策略的,允许在行尾自带 `no-resolve` /
 * `extended-matching` 之类的 per-line option
 * (manual.nssurge.com/rules/ruleset.html#external-rule-sets)。
 * 把这种行展开进 [Rule] 时必须把行内 option 挪到策略后面,否则 option 会占掉策略的位置,
 * 客户端会把 `no-resolve` 当成策略名。
 *
 * 另一件事是修饰符的适用范围:`no-resolve` 只对「目标 IP」类规则有意义
 * (Surge: IP-CIDR / IP-CIDR6 / GEOIP / IP-ASN;mihomo 另有 IP-SUFFIX),
 * `extended-matching` 只对域名类规则有意义。规则集级别的开关展开到混合 payload
 * (域名 + IP 混写)时按行分发,避免给不适用的行挂上无效修饰符。
 */

// 目标 IP 类规则:匹配前需要拿到解析后的 IP,因此支持 no-resolve。
// SRC-* 系列匹配来源 IP,不触发解析,不在此列。
const IP_RULE_TYPES = new Set(["IP-CIDR", "IP-CIDR6", "IP-SUFFIX", "IP-ASN", "GEOIP"]);

// 域名类规则:支持 extended-matching(同时匹配 TLS SNI 与 HTTP Host)。
const DOMAIN_RULE_TYPES = new Set([
  "DOMAIN",
  "DOMAIN-SUFFIX",
  "DOMAIN-KEYWORD",
  "DOMAIN-WILDCARD",
  "URL-REGEX",
]);

// 行尾可能出现的无值 option。用于把行内自带的 option 与 VALUE 区分开。
const INLINE_OPTION_FLAGS = new Set([
  "no-resolve",
  "extended-matching",
  "pre-matching",
  "force-remote-dns",
  "requires-resolve",
  "src", // mihomo 专属:把目标 IP 匹配转为来源 IP 匹配
]);

// 行尾可能出现的 key=value option。
const INLINE_OPTION_KEYS = new Set([
  "update-interval",
  "notification-text",
  "notification-interval",
  "always-capture",
]);

function isInlineOption(token: string): boolean {
  const t = token.trim().toLowerCase();
  if (INLINE_OPTION_FLAGS.has(t)) return true;
  const eq = t.indexOf("=");
  return eq > 0 && INLINE_OPTION_KEYS.has(t.slice(0, eq));
}

export interface ParsedRuleLine {
  /** 规则类型,统一大写 */
  type: string;
  /** `TYPE,VALUE` 部分,原样保留(可能含引号包裹的逗号或逻辑规则的括号) */
  head: string;
  /** 行尾自带的 option,顺序保留 */
  options: string[];
}

export function parseInlineRuleLine(line: string): ParsedRuleLine {
  const parts = line.split(",");
  const options: string[] = [];
  // 至少留下 TYPE,VALUE 两段,不然带引号正则或逻辑规则会被拆坏。
  while (parts.length > 2 && isInlineOption(parts[parts.length - 1]!)) {
    options.unshift(parts.pop()!.trim());
  }
  return {
    type: (parts[0] ?? "").trim().toUpperCase(),
    head: parts.join(","),
    options,
  };
}

export function flagAppliesToRuleType(flag: string, ruleType: string): boolean {
  switch (flag) {
    case "no-resolve":
      return IP_RULE_TYPES.has(ruleType);
    case "extended-matching":
      return DOMAIN_RULE_TYPES.has(ruleType);
    default:
      return true;
  }
}

/**
 * 把一条 inline payload 行展开成带策略的整行。
 * 规则集级别的 flags 按行的规则类型过滤;行内已自带的 option 保持在前且不重复追加。
 */
export function buildExpandedRuleLine(args: {
  item: string;
  policy: string;
  extraParams?: string[];
  flags?: string[];
}): string {
  const { type, head, options } = parseInlineRuleLine(args.item);
  const merged = [...options];
  for (const flag of args.flags ?? []) {
    if (!flagAppliesToRuleType(flag, type)) continue;
    if (!merged.includes(flag)) merged.push(flag);
  }
  return [head, args.policy, ...(args.extraParams ?? []), ...merged].join(",");
}
