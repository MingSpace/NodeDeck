import type { Profile } from "../schemas/profile.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import type { SurgeModule } from "../schemas/surge-module.js";
import type { Node } from "../schemas/node.js";
import type { Provider } from "../schemas/provider.js";
import { providerRepo, proxyGroupRepo, rulesetRepo, generalPresetRepo, surgeModuleRepo } from "../storage/repos.js";
import { buildNodePool } from "../providers/pool.js";

export interface ResolvedProfile {
  profile: Profile;
  nodes: Node[];
  // 启用且被该 profile 引用的 provider 元数据(给 clash proxy-providers 模式合成 URL 用)
  providers: Provider[];
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
  surgeModules: SurgeModule[];
  warnings: string[];
}

export async function resolveProfile(profile: Profile): Promise<ResolvedProfile> {
  const warnings: string[] = [];
  const pool = await buildNodePool({
    providerIds: profile.providers,
    includeManual: profile.include_manual_nodes,
  });

  const providers: Provider[] = [];
  for (const id of profile.providers) {
    const entry = await providerRepo.get(id);
    if (entry && entry.data.enabled) providers.push(entry.data);
  }

  const groups: ProxyGroup[] = [];
  for (const id of profile.proxy_groups) {
    const entry = await proxyGroupRepo.get(id);
    if (entry) groups.push(entry.data);
    else warnings.push(`proxy_group "${id}" not found`);
  }

  // 全局 group 名集合,只供诊断用(详见 ResolvedProfile.allKnownGroupNames 注释)
  const allGroupEntries = await proxyGroupRepo.list();
  const allKnownGroupNames = new Set(allGroupEntries.map((e) => e.data.name));

  const rules: { ref: string; policy: string; ruleset: RuleSet }[] = [];
  let finalRule: ResolvedProfile["finalRule"];
  let geoipFallback: ResolvedProfile["geoipFallback"];
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
    const entry = await rulesetRepo.get(item.ref);
    if (entry) rules.push({ ref: item.ref, policy: item.policy, ruleset: entry.data });
    else warnings.push(`ruleset "${item.ref}" not found`);
  }

  let general: GeneralPreset | undefined;
  if (profile.general_preset) {
    const entry = await generalPresetRepo.get(profile.general_preset);
    if (entry) general = entry.data;
    else warnings.push(`general_preset "${profile.general_preset}" not found`);
  }

  const surgeModules: SurgeModule[] = [];
  for (const id of profile.surge_modules) {
    const entry = await surgeModuleRepo.get(id);
    if (entry) surgeModules.push(entry.data);
    else warnings.push(`surge_module "${id}" not found`);
  }

  return {
    profile,
    nodes: pool.nodes,
    providers,
    groups,
    allKnownGroupNames,
    rules,
    finalRule,
    geoipFallback,
    general,
    surgeModules,
    warnings,
  };
}
