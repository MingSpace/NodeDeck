import { Hono } from "hono";
import { listProvidersWithCache, buildNodePool } from "../providers/pool.js";
import { readProviderCache } from "../providers/cache-store.js";
import { providerRepo, profileRepo } from "../storage/repos.js";
import { resolveProfile } from "../generators/profile-resolver.js";
import { generateClashConfig } from "../generators/clash.js";
import { generateSurgeConfig } from "../generators/surge.js";
import { applyNodeFilter } from "../generators/node-filter.js";
import { summarizePulls } from "../stats/pull-stats.js";
import type { Node } from "../schemas/node.js";
import type { Profile } from "../schemas/profile.js";

export const dashboardRouter = new Hono();

dashboardRouter.get("/airports", async (c) => {
  const summaries = await listProvidersWithCache();
  const items = await Promise.all(
    summaries.map(async (s) => {
      const cache = await readProviderCache(s.provider.id);
      return {
        id: s.provider.id,
        name: s.provider.name,
        type: s.provider.type,
        url: s.provider.url,
        enabled: s.provider.enabled,
        status: s.status ?? "unknown",
        node_count: s.node_count,
        fetched_at: s.fetched_at,
        error: s.error,
        // 仪表板据此区分「沿用旧节点」与「离线」,与节点源列表页同源
        retry_failures: s.retry_failures,
        offline: s.offline,
        userinfo: cache?.userinfo,
        // 上次拉取之后过了重置日:userinfo 是上个周期的旧数(判定见 providers/quota.ts)
        traffic_reset_pending: s.quota.traffic_reset_pending,
        raw_userinfo_header: cache?.raw_userinfo_header,
      };
    }),
  );
  return c.json({ items });
});

/**
 * 仪表板 Profile 卡片上的流水线:每个 Profile 最终出几个节点、生成时有哪些警告。
 * 两端各生成一遍收集 warnings(有的只在一端出现,如 Clash 忽略组级 underlying_proxy;
 * Clash 按设计跳过的 DEVICE: / SUBNET / SYSTEM 走 notes,不算警告),
 * 与编辑器实时预览同一套管线;走 SWR,没有 cache 的节点源不在这里同步等网络。
 */
async function profileHealth(profile: Profile) {
  const resolved = await resolveProfile(profile, { staleWhileRevalidate: true });
  const base = {
    profile,
    nodes: resolved.nodes,
    providers: resolved.providers,
    groups: resolved.groups,
    allKnownGroupNames: resolved.allKnownGroupNames,
    rules: resolved.rules,
    finalRule: resolved.finalRule,
    geoipFallback: resolved.geoipFallback,
    general: resolved.general,
  };
  const clashWarnings = [...resolved.warnings];
  const surgeWarnings = [...resolved.warnings, ...resolved.surgeWarnings];
  generateClashConfig({ ...base, warnings: clashWarnings });
  // managed_config_url 只影响产物头部,不产生 warning,这里不必拼真实地址
  generateSurgeConfig({ ...base, surgeModules: resolved.surgeModules, warnings: surgeWarnings });
  return {
    id: profile.id,
    node_count: applyNodeFilter(resolved.nodes, profile.node_filter).length,
    warnings: [...new Set([...clashWarnings, ...surgeWarnings])],
    revalidating: resolved.revalidating.length > 0,
  };
}

dashboardRouter.get("/profiles", async (c) => {
  const entries = await profileRepo.list();
  const items = await Promise.all(
    entries.map((e) =>
      // 一个 Profile 生成抛错不该拖垮整个仪表板,降级成一条警告
      profileHealth(e.data).catch((err: unknown) => ({
        id: e.data.id,
        node_count: 0,
        warnings: [`生成失败: ${err instanceof Error ? err.message : String(err)}`],
        revalidating: false,
      })),
    ),
  );
  return c.json({ items });
});

/** 订阅拉取统计:近 30 天每日次数(分 Clash / Surge)、各 Profile 近 7 天次数、最近 7 天拉过的设备 */
dashboardRouter.get("/pulls", (c) => c.json(summarizePulls(30)));

/**
 * 节点池构成:按地区 / 协议计数,给仪表盘画分布条。
 * 走 SWR,和 /profiles 一样不在这里同步等网络;没识别出地区的节点归到 region 为空的一桶。
 */
dashboardRouter.get("/pool", async (c) => {
  const pool = await buildNodePool({ staleWhileRevalidate: true });
  const regions = new Map<string, number>();
  const types = new Map<string, number>();
  for (const n of pool.nodes) {
    const r = n.region ?? "";
    regions.set(r, (regions.get(r) ?? 0) + 1);
    types.set(n.type, (types.get(n.type) ?? 0) + 1);
  }
  const sorted = (m: Map<string, number>) =>
    [...m.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count);
  return c.json({
    total: pool.nodes.length,
    regions: sorted(regions),
    types: sorted(types),
    revalidating: pool.revalidating.length > 0,
  });
});

dashboardRouter.get("/summary", async (c) => {
  const [providers, profiles] = await Promise.all([providerRepo.list(), profileRepo.list()]);
  return c.json({
    providers: providers.length,
    profiles: profiles.length,
  });
});

dashboardRouter.get("/node-pool", async (c) => {
  const pool = await buildNodePool();
  const byProvider: Record<string, Node[]> = {};
  for (const [provId, nodes] of pool.byProvider) {
    byProvider[provId] = nodes;
  }
  return c.json({
    nodes: pool.nodes,
    count: pool.nodes.length,
    by_provider: byProvider,
  });
});
