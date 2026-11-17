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

// 与 backend/src/stats/pull-stats.ts PullSummary 保持同步
export interface PullSummary {
  days: { date: string; clash: number; surge: number }[];
  today: number;
  since?: string;
  rejected: number;
  profiles: Record<string, ProfilePulls>;
  devices: PullClient[];
}

// 与 backend/src/stats/pull-stats.ts 的 devices 项 + backend/src/stats/user-agent.ts 保持同步
export interface PullClient {
  ip: string;
  client: string;
  user_agent: string;
  profile_id: string;
  target: "clash" | "surge";
  first_seen: number;
  last_seen: number;
  count: number;
  version?: string;
  components: string[];
  os?: string;
  device?: string;
  ip_scope: "loopback" | "private" | "public" | "unknown";
}

export interface ProfilePulls {
  last7: number;
  last_pull_at?: number;
}

// 与 backend/src/routes/dashboard.ts 的 /pool 响应保持同步
export interface PoolSummary {
  total: number;
  regions: { key: string; count: number }[];
  types: { key: string; count: number }[];
  revalidating: boolean;
}
