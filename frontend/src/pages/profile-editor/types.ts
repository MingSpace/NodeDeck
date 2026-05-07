export interface NodeFilter {
  include_regex?: string;
  exclude_regex?: string;
  rename_rules: { pattern: string; replace: string; flags?: string }[];
  exclude_types: string[];
}

export interface ChainRule {
  selector: {
    include_regex?: string;
    exclude_regex?: string;
    include_other_group?: string[];
    from_providers?: string[];
    exclude_type?: string[];
  };
  via: string;
  comment?: string;
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
  include_manual_nodes: boolean;
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
