// 与 backend/src/routes/dashboard.ts 的 /airports、/profiles 响应保持同步

export type ProviderType = "http" | "file" | "inline";

export interface AirportItem {
  id: string;
  name: string;
  type: ProviderType;
  url?: string;
  enabled: boolean;
  status: "ok" | "stale" | "error" | "unknown";
  node_count: number;
  fetched_at?: number;
  error?: string;
  /** 连续拉取失败次数;满阈值后 offline = true */
  retry_failures?: number;
  offline?: boolean;
  userinfo?: { upload: number; download: number; total: number; expire: number };
  raw_userinfo_header?: string;
}

export interface Profile {
  id: string;
  name: string;
  description?: string;
  token: string;
  providers: string[];
  proxy_groups: string[];
  rule_modules: unknown[];
  chain_rules: unknown[];
  surge_modules: string[];
}

export interface ProfileHealth {
  id: string;
  node_count: number;
  warnings: string[];
  revalidating: boolean;
}
