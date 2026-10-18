import type { Profile } from "../schemas/profile.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import type { SurgeModule } from "../schemas/surge-module.js";
import type { Node } from "../schemas/node.js";
import type { Provider } from "../schemas/provider.js";
import { providerRepo, proxyGroupRepo, rulesetRepo, generalPresetRepo, surgeModuleRepo } from "../storage/repos.js";
import { buildNodePool } from "../providers/pool.js";
import { readProviderCache } from "../providers/cache-store.js";
import { describeQuotaExclusion, evaluateProviderQuota } from "../providers/quota.js";
import { mergeHostMaps } from "./hosts.js";

export interface ResolvedProfile {
  profile: Profile;
  nodes: Node[];
  // 启用且被该 profile 引用的 provider 元数据(给 clash proxy-providers 模式合成 URL 用)。
  // 含被配额排除的源:节点名前缀在这批源之间消歧,排除谁都不能让其它源的前缀跟着变。
  providers: Provider[];
  // 流量用完 / 已到期而被排除的 provider id(节点已不在 nodes 里,proxy-providers 段也要跳过)
  excludedProviderIds: Set<string>;
  groups: ProxyGroup[];
  /**
   * 系统中**所有** group 的 name 集合(不只是 profile.proxy_groups 引用的)。
   * 仅供 generator 阶段做 *诊断*用:当某个被引用的名字不在 profile.groups 里、
   * 但能在这里找到,就能精准提示"该 group 已存在 yaml,但未在 profile.proxy_groups 启用,
   * 请到 Profile 编辑器加进来",而不是误报为"被 node_filter 过滤掉的悬空节点"。
   *
   * **不影响**实际加载哪些 group;profile.proxy_groups 仍是唯一真相。
   */
  allKnownGroupNames: Set<string>;
  rules: { ref: string; policy: string; ruleset: RuleSet }[];
  finalRule?: { policy: string; dns_failed?: boolean };
  geoipFallback?: { policy: string };
  general?: GeneralPreset;
  // general.hosts + 启用且 emit_hosts 的 provider.hosts 去重合并后的结果(两端 generator 消费)。
  hosts?: Record<string, string[]>;
  surgeModules: SurgeModule[];
  warnings: string[];
  // SWR 预览路径下,当前没有可用 cache、正在后台刷新的 provider id 列表(真实下发路径恒为空)。
  revalidating: string[];
}

export async function resolveProfile(
  profile: Profile,
  opts: { staleWhileRevalidate?: boolean } = {},
): Promise<ResolvedProfile> {
  const warnings: string[] = [];

  // providers 先串行读出来算配额,其余 IO(节点池 / groups / rulesets / general / surge modules /
  // 全 group 列表)再全部并发起飞。warnings 仍然按 profile 中的原始顺序生成,与串行版输出一致。
  const ruleRefs = profile.rule_modules.flatMap((m) =>
    "final" in m || "geoip_cn" in m || m.enabled === false ? [] : [m.ref],
  );

  // 配额要先于节点池算出来:被排除的源不进池,也就不会为它去拉机场。
  // 判定用的是上次刷新写进 cache 的 userinfo,on_request 源因此最多滞后一次请求。
  const providerEntries = await Promise.all(profile.providers.map((id) => providerRepo.get(id)));
  const providers = providerEntries.flatMap((entry) => (entry && entry.data.enabled ? [entry.data] : []));
  const excludedProviderIds = await quotaExcludedIds(providers, warnings);
  const activeProviders = providers.filter((p) => !excludedProviderIds.has(p.id));

  const [pool, groupEntries, ruleEntries, generalEntry, surgeModuleEntries, allGroupEntries] =
    await Promise.all([
      buildNodePool({
        providerIds: profile.providers.filter((id) => !excludedProviderIds.has(id)),
        staleWhileRevalidate: opts.staleWhileRevalidate,
      }),
      Promise.all(profile.proxy_groups.map((id) => proxyGroupRepo.get(id))),
      Promise.all(ruleRefs.map((ref) => rulesetRepo.get(ref))),
      profile.general_preset ? generalPresetRepo.get(profile.general_preset) : Promise.resolve(null),
      Promise.all(profile.surge_modules.map((id) => surgeModuleRepo.get(id))),
      proxyGroupRepo.list(),
    ]);

  const groups: ProxyGroup[] = [];
  profile.proxy_groups.forEach((id, i) => {
    const entry = groupEntries[i];
    if (entry) groups.push(entry.data);
    else warnings.push(`proxy_group "${id}" not found`);
  });

  const allKnownGroupNames = new Set(allGroupEntries.map((e) => e.data.name));

  const rules: { ref: string; policy: string; ruleset: RuleSet }[] = [];
  let finalRule: ResolvedProfile["finalRule"];
  let geoipFallback: ResolvedProfile["geoipFallback"];
  let ruleIdx = 0;
  for (const item of profile.rule_modules) {
    if ("final" in item) {
      finalRule = { policy: item.final, dns_failed: item.dns_failed };
      continue;
    }
    if ("geoip_cn" in item) {
      geoipFallback = { policy: item.policy };
      continue;
    }
    if (item.enabled === false) continue;
    const entry = ruleEntries[ruleIdx++];
    if (entry) rules.push({ ref: item.ref, policy: item.policy, ruleset: entry.data });
    else warnings.push(`ruleset "${item.ref}" not found`);
  }

  let general: GeneralPreset | undefined;
  if (profile.general_preset) {
    if (generalEntry) general = generalEntry.data;
    else warnings.push(`general_preset "${profile.general_preset}" not found`);
  }

  const surgeModules: SurgeModule[] = [];
  profile.surge_modules.forEach((id, i) => {
    const entry = surgeModuleEntries[i];
    if (entry) surgeModules.push(entry.data);
    else warnings.push(`surge_module "${id}" not found`);
  });

  // hosts 合并:general.hosts → 各启用 provider 的手动 hosts → 各 provider 上游自动解析的 hosts。
  // emit_hosts 关闭的 provider 两类都不带出。自动解析结果随刷新写入 provider cache
  // (buildNodePool 上面已跑过,on_request 源此刻 cache 是最新的),故"每次更新自动解析并应用"。
  // 同 key 多值会在 Surge 端展开多行 / Clash 端走 proxy-server-nameserver-policy。
  const providerCaches = await Promise.all(activeProviders.map((p) => readProviderCache(p.id)));
  const emitProviders = activeProviders
    .map((p, i) => ({ provider: p, cache: providerCaches[i] }))
    .filter(({ provider }) => provider.emit_hosts !== false);
  const mergedHosts = mergeHostMaps(
    general?.hosts,
    ...emitProviders.map(({ provider }) => provider.hosts),
    ...emitProviders.map(({ cache }) => cache?.extracted_hosts),
  );
  const hosts = Object.keys(mergedHosts).length > 0 ? mergedHosts : undefined;

  return {
    profile,
    nodes: pool.nodes,
    providers,
    excludedProviderIds,
    groups,
    allKnownGroupNames,
    rules,
    finalRule,
    geoipFallback,
    general,
    hosts,
    surgeModules,
    warnings,
    // mock 测试可能不返回该字段,容错为空数组。
    revalidating: pool.revalidating ?? [],
  };
}

/**
 * 剔除流量用完 / 已到期的节点源(判定见 providers/quota.ts),每个被剔除的源记一条 warning。
 * 全部源都被剔除时宁可照常输出:空订阅会让客户端所有策略组失效,比连不上的节点更糟。
 */
async function quotaExcludedIds(providers: Provider[], warnings: string[]): Promise<Set<string>> {
  const caches = await Promise.all(providers.map((p) => readProviderCache(p.id)));
  const now = Date.now();
  const statuses = providers.map((p, i) => evaluateProviderQuota(p, caches[i], now));
  const excluded = new Set(providers.filter((_, i) => statuses[i].excluded).map((p) => p.id));
  if (excluded.size > 0 && excluded.size === providers.length) {
    warnings.push("所有节点源都流量用完或已到期,本次不做排除,照常输出全部节点");
    return new Set();
  }
  providers.forEach((p, i) => {
    if (statuses[i].excluded) warnings.push(describeQuotaExclusion(p.name, statuses[i]));
  });
  return excluded;
}
