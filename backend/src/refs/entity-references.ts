import { loadNotificationConfig } from "../storage/notification-store.js";
import {
  rulesetRepo,
  proxyGroupRepo,
  generalPresetRepo,
  profileRepo,
} from "../storage/repos.js";
import type { Profile } from "../schemas/profile.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { NotificationConfig } from "../schemas/notification.js";

/**
 * 可被其它实体引用的实体类型。`profiles` 不在列表里 —— 它是引用链的终点,
 * 没有任何实体引用 profile(订阅 URL 直接按 token 找 profile,不构成实体间引用)。
 */
export const REFERENCEABLE_KINDS = ["providers", "rules", "groups", "generals", "modules"] as const;
export type ReferenceableKind = (typeof REFERENCEABLE_KINDS)[number];

export function isReferenceableKind(kind: string): kind is ReferenceableKind {
  return (REFERENCEABLE_KINDS as readonly string[]).includes(kind);
}

export interface EntityReference {
  /** 引用方实体类型;`notification` 是全局配置文件而不是列表实体 */
  from_kind: "profiles" | "groups" | "generals" | "rules" | "notification";
  /** 引用方 id(notification 固定为 `notification`) */
  from_id: string;
  /** 引用方展示名 */
  from_name: string;
  /** 引用字段路径,如 `proxy_groups`、`rule_modules[2].policy` */
  field: string;
  /** 引用按 id 建立还是按 name 建立(按 name 的引用在同名实体仍存在时不算悬空) */
  via: "id" | "name";
  /** 被引用的具体值(id 或 name),便于用户在源文件里定位 */
  value: string;
  /**
   * false = 只影响 Web UI 的展示/默认值,不会让生成的 clash/surge 产物出错,
   * 所以不阻止删除。目前只有 `ruleset.policy`(generator 不读它,实际策略取自
   * profile.rule_modules[].policy)。
   */
  blocking: boolean;
}

interface Sources {
  profiles: Profile[];
  groups: ProxyGroup[];
  generals: GeneralPreset[];
  rules: RuleSet[];
  notification: NotificationConfig;
}

async function loadSources(): Promise<Sources> {
  const [profiles, groups, generals, rules, notification] = await Promise.all([
    profileRepo.list(),
    proxyGroupRepo.list(),
    generalPresetRepo.list(),
    rulesetRepo.list(),
    loadNotificationConfig(),
  ]);
  return {
    profiles: profiles.map((e) => e.data),
    groups: groups.map((e) => e.data),
    generals: generals.map((e) => e.data),
    rules: rules.map((e) => e.data),
    notification,
  };
}

/**
 * 找出所有指向 `kind/id` 的引用。空数组 = 可以安全删除。
 *
 * 扫描的是文件里的**声明**,不是 generator 的运行时结果:某个 profile 把该组列在
 * `proxy_groups` 里就算引用,不管这个 profile 当前是否还能生成成功。
 */
export async function findEntityReferences(
  kind: ReferenceableKind,
  id: string,
): Promise<EntityReference[]> {
  const sources = await loadSources();
  switch (kind) {
    case "providers":
      return findProviderReferences(id, sources);
    case "rules":
      return findRulesetReferences(id, sources);
    case "groups":
      return findGroupReferences(id, sources);
    case "generals":
      return findGeneralPresetReferences(id, sources);
    case "modules":
      return findSurgeModuleReferences(id, sources);
  }
}

function profileRef(
  profile: Profile,
  field: string,
  value: string,
  via: "id" | "name" = "id",
): EntityReference {
  return {
    from_kind: "profiles",
    from_id: profile.id,
    from_name: profile.name,
    field,
    via,
    value,
    blocking: true,
  };
}

// ---------------------------------------------------------------------------
// providers —— 全部按 id 引用
// ---------------------------------------------------------------------------

function findProviderReferences(id: string, s: Sources): EntityReference[] {
  const refs: EntityReference[] = [];

  for (const p of s.profiles) {
    if (p.providers.includes(id)) refs.push(profileRef(p, "providers", id));
    if (p.userinfo.primary_provider === id) {
      refs.push(profileRef(p, "userinfo.primary_provider", id));
    }
    p.chain_rules.forEach((rule, i) => {
      if (rule.selector.from_providers.includes(id)) {
        refs.push(profileRef(p, `chain_rules[${i}].selector.from_providers`, id));
      }
    });
    if (p.hidden_nodes?.from_providers.includes(id)) {
      refs.push(profileRef(p, "hidden_nodes.from_providers", id));
    }
  }

  for (const g of s.groups) {
    if (g.selector?.from_providers.includes(id)) {
      refs.push({
        from_kind: "groups",
        from_id: g.id,
        from_name: g.name,
        field: "selector.from_providers",
        via: "id",
        value: id,
        blocking: true,
      });
    }
    if (g.use?.includes(id)) {
      refs.push({
        from_kind: "groups",
        from_id: g.id,
        from_name: g.name,
        field: "use",
        via: "id",
        value: id,
        blocking: true,
      });
    }
  }

  // provider_ids 为 null 表示"所有启用的 http 源",不构成对具体 id 的引用
  if (s.notification.events.userinfo_alert.provider_ids?.includes(id)) {
    refs.push({
      from_kind: "notification",
      from_id: "notification",
      from_name: "通知设置",
      field: "events.userinfo_alert.provider_ids",
      via: "id",
      value: id,
      blocking: true,
    });
  }

  return refs;
}

// ---------------------------------------------------------------------------
// rules(ruleset)—— 只被 profile.rule_modules[].ref 按 id 引用
// ---------------------------------------------------------------------------

function findRulesetReferences(id: string, s: Sources): EntityReference[] {
  const refs: EntityReference[] = [];
  for (const p of s.profiles) {
    p.rule_modules.forEach((item, i) => {
      if ("ref" in item && item.ref === id) {
        refs.push(profileRef(p, `rule_modules[${i}].ref`, id));
      }
    });
  }
  return refs;
}

// ---------------------------------------------------------------------------
// generals / modules —— 只被 profile 按 id 引用
// ---------------------------------------------------------------------------

function findGeneralPresetReferences(id: string, s: Sources): EntityReference[] {
  return s.profiles
    .filter((p) => p.general_preset === id)
    .map((p) => profileRef(p, "general_preset", id));
}

function findSurgeModuleReferences(id: string, s: Sources): EntityReference[] {
  return s.profiles
    .filter((p) => p.surge_modules.includes(id))
    .map((p) => profileRef(p, "surge_modules", id));
}

// ---------------------------------------------------------------------------
// groups —— profile.proxy_groups 按 id;策略位置(policy / via / 嵌套组)按 name
// ---------------------------------------------------------------------------

function findGroupReferences(id: string, s: Sources): EntityReference[] {
  const refs: EntityReference[] = [];

  for (const p of s.profiles) {
    if (p.proxy_groups.includes(id)) refs.push(profileRef(p, "proxy_groups", id));
  }

  const target = s.groups.find((g) => g.id === id);
  if (!target) return refs;
  const name = target.name;

  // 按 name 的引用只有在删掉后这个名字彻底消失时才算悬空;
  // 存在同名的另一个组(name 不是主键)时,客户端仍能解析到策略,不拦。
  const nameStillResolvable = s.groups.some((g) => g.id !== id && g.name === name);
  if (nameStillResolvable) return refs;

  for (const p of s.profiles) {
    p.rule_modules.forEach((item, i) => {
      if ("ref" in item && item.policy === name) {
        refs.push(profileRef(p, `rule_modules[${i}].policy`, name, "name"));
      } else if ("final" in item && item.final === name) {
        refs.push(profileRef(p, `rule_modules[${i}].final`, name, "name"));
      } else if ("geoip_cn" in item && item.policy === name) {
        refs.push(profileRef(p, `rule_modules[${i}].policy`, name, "name"));
      }
    });
    p.chain_rules.forEach((rule, i) => {
      if (rule.via === name) {
        refs.push(profileRef(p, `chain_rules[${i}].via`, name, "name"));
      }
      if (rule.selector.include_groups.includes(name)) {
        refs.push(profileRef(p, `chain_rules[${i}].selector.include_groups`, name, "name"));
      }
    });
  }

  for (const g of s.groups) {
    if (g.id === id) continue;
    const push = (field: string) =>
      refs.push({
        from_kind: "groups",
        from_id: g.id,
        from_name: g.name,
        field,
        via: "name",
        value: name,
        blocking: true,
      });
    if (g.nested_groups.includes(name)) push("nested_groups");
    if (g.include_other_group === name) push("include_other_group");
    if (g.ssid_params?.default === name) push("ssid_params.default");
    if (g.ssid_params?.cellular === name) push("ssid_params.cellular");
    for (const [ssid, policy] of Object.entries(g.ssid_params?.wifi ?? {})) {
      if (policy === name) push(`ssid_params.wifi[${ssid}]`);
    }
  }

  for (const gp of s.generals) {
    gp.ssid_rules?.forEach((rule, i) => {
      if (rule.policy === name) {
        refs.push({
          from_kind: "generals",
          from_id: gp.id,
          from_name: gp.name,
          field: `ssid_rules[${i}].policy`,
          via: "name",
          value: name,
          blocking: true,
        });
      }
    });
  }

  for (const rs of s.rules) {
    if (rs.policy === name) {
      refs.push({
        from_kind: "rules",
        from_id: rs.id,
        from_name: rs.name,
        field: "policy",
        via: "name",
        value: name,
        // 只是规则集自带的"建议策略",generator 用的是 profile.rule_modules[].policy,
        // 悬空不会影响产物 —— 提示但不阻止删除。
        blocking: false,
      });
    }
  }

  return refs;
}

const KIND_LABELS: Record<EntityReference["from_kind"], string> = {
  profiles: "Profile",
  groups: "策略组",
  generals: "全局配置",
  rules: "规则集",
  notification: "通知设置",
};

/** 给 409 响应 / 日志用的一句话中文摘要(前端弹窗自己渲染完整清单)。 */
export function describeReferences(refs: EntityReference[], limit = 3): string {
  const shown = refs
    .slice(0, limit)
    .map((r) => `${KIND_LABELS[r.from_kind]}「${r.from_name}」的 ${r.field}`);
  const rest = refs.length - shown.length;
  return rest > 0 ? `${shown.join("、")} 等 ${refs.length} 处` : shown.join("、");
}
