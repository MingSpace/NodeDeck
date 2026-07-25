export interface NodeFilter {
  include_regex?: string;
  exclude_regex?: string;
  rename_rules: { pattern: string; replace: string; flags?: string }[];
  exclude_types: string[];
  sort_by_region?: boolean;
}

/**
 * 链式规则的作用域。与后端 chainSelectorSchema 一一对应。
 *
 * 组合语义:`include_groups` 与 `include_nodes` 之间是 OR(命中任一即落在作用域内),
 * 与其余条件之间是 AND;全部留空 = 匹配全部节点。详见 backend/src/chain/apply.ts。
 */
export interface ChainSelector {
  include_regex?: string;
  exclude_regex?: string;
  /** @deprecated v1 遗留字段,chain 侧从未消费;按组圈定请用 include_groups */
  include_other_group?: string[];
  from_providers?: string[];
  include_type?: string[];
  exclude_type?: string[];
  include_region?: string[];
  include_nodes?: string[];
  include_groups?: string[];
}

export type ChainMode = "override" | "fill";

export interface ChainRule {
  enabled?: boolean;
  selector: ChainSelector;
  via: string;
  mode?: ChainMode;
  comment?: string;
}

export type ChainViaStatus = "node" | "group" | "builtin" | "missing";
export type ChainTerminal = ChainViaStatus | "cycle";

export interface ChainRuleStat {
  index: number;
  enabled: boolean;
  via: string;
  via_status: ChainViaStatus;
  mode: ChainMode;
  matched_count: number;
  effective_count: number;
  kept_existing_count: number;
  sample: string[];
}

export interface ChainPreviewResp {
  node_count: number;
  rules: ChainRuleStat[];
  unmatched_count: number;
  conflicts: { node: string; rules: number[] }[];
  conflict_count: number;
  chains: { node: string; path: string[]; terminal: ChainTerminal }[];
  groups: { name: string; member_count: number }[];
  nodes: { name: string; type: string; region?: string; source_provider_id?: string }[];
  warnings: string[];
  // true = 有机场当前无 cache、正在后台首次拉取,结果稍后可用(前端据此短轮询)。
  revalidating?: boolean;
}

export type RuleModuleRef =
  | { ref: string; policy: string; enabled?: boolean; note?: string }
  | { final: string; dns_failed?: boolean }
  | { geoip_cn: boolean; policy: string };

export interface Profile {
  id: string;
  name: string;
  description?: string;
  token: string;
  providers: string[];
  node_filter: NodeFilter;
  chain_rules: ChainRule[];
  proxy_groups: string[];
  rule_modules: RuleModuleRef[];
  surge_modules: string[];
  general_preset?: string;
  userinfo: {
    enabled: boolean;
    mode: "primary" | "sum";
    primary_provider?: string;
    expose_per_provider_headers: boolean;
  };
  managed_config_url: string;
  managed_config_interval: number;
  managed_config_strict: boolean;
  clash_options: {
    use_proxy_providers: boolean;
    flag: "mihomo" | "stash";
    group_style: "block" | "flow";
  };
}

export interface NodePoolPreviewItem {
  name: string;
  type: string;
  server: string;
  port: number;
  region?: string;
  level?: string;
  line?: string;
  source_provider_id?: string;
  tags?: string[];
}

export interface NodePoolPreviewResp {
  nodes: NodePoolPreviewItem[];
  count: number;
  raw_count: number;
  by_provider: Record<string, number>;
  // true = 有机场当前无 cache、正在后台首次拉取,结果稍后可用(前端据此短轮询)。
  revalidating?: boolean;
}

export function isFinalRule(r: RuleModuleRef): r is { final: string; dns_failed?: boolean } {
  return "final" in r;
}

export function isGeoipRule(r: RuleModuleRef): r is { geoip_cn: boolean; policy: string } {
  return "geoip_cn" in r;
}

export function isRuleSetRef(
  r: RuleModuleRef,
): r is { ref: string; policy: string; enabled?: boolean; note?: string } {
  return "ref" in r;
}
