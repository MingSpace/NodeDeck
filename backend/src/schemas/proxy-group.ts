import { z } from "zod";
import { idSchema } from "./common.js";

export const proxyGroupTypeSchema = z.enum([
  "select", // [CS]
  "url-test", // [CS]
  "fallback", // [CS]
  "load-balance", // [CS]
  "smart", // [S] iOS 5.14+ Surge Smart
  "ssid", // [S]
  "external", // [S] external proxy program
]);

export const selectorSchema = z.object({
  include_regex: z.string().optional(),
  exclude_regex: z.string().optional(),
  /**
   * @deprecated 历史字段(NodeDeck v1):语义本应是"把其它组作为单个 proxy 项嵌套引用",
   * 但旧版命名 + 旧 UI 把它当作"合并其它组成员"展示,造成用户理解错乱。
   * v2 起改用顶层 `nested_groups` 字段(语义更清晰、存 group name 而非 id),
   * schema 在 transform 阶段会把这里的值搬到 `nested_groups` 并清空本字段。
   * 保留是为了让旧 yaml 仍能加载 + 老的 chain_rules selector(那里这字段从未被使用,
   * `chain/apply.ts` 的 `matchesSelector` 也没读它,纯透传)不报 schema 校验失败。
   */
  include_other_group: z.array(z.string()).default([]),
  from_providers: z.array(z.string()).default([]),
  exclude_type: z.array(z.string()).default([]),
  // 地区白名单:空 = 不限制;非空 = 只保留 node.region ∈ 列表 的节点。
  // 用 string[] 而不是 regionCodeSchema[],给将来加新国家留余地,旧 yaml 不会失效。
  include_region: z.array(z.string()).default([]),
});

const proxyGroupBaseSchema = z.object({
  id: idSchema,
  name: z.string().min(1),
  type: proxyGroupTypeSchema.default("select"),

  // explicit list — 仅放 *节点名* 与内置 policy (DIRECT / REJECT*);
  // 其它策略组的嵌套引用走专门的 nested_groups 字段,不要混进来。
  proxies: z.array(z.string()).default([]),

  /**
   * 嵌套引用的其它策略组(作为单个 proxy 项加入当前组的 yaml proxies 列表)。
   * 存 group **name**(不是 id),直接对应 mihomo / Surge 客户端的嵌套选择器:
   * 客户端展示 当前组 → 看到这些组名作为可选项 → 点进去再走那个组的选择逻辑。
   *
   * 与顶层 `include_other_group: string`(Surge 原生 include-other-group 参数,
   * 语义是把其它组的成员节点**平铺展开**到当前组)完全不同 — 不要混淆。
   *
   * 旧字段 `selector.include_other_group` 在 schema transform 阶段会被搬到这里。
   */
  nested_groups: z.array(z.string()).default([]),

  // dynamic selector
  selector: selectorSchema.optional(),

  // [CS] test parameters
  url: z.string().url().optional(),
  interval: z.number().int().min(1).max(86400).optional(),
  tolerance: z.number().int().min(0).max(10000).optional(),
  timeout: z.number().int().min(1).max(60).optional(),

  // [S] surge-only
  evaluate_before_use: z.boolean().optional(),
  hidden: z.boolean().optional(),
  persistent: z.boolean().optional(),
  policy_path: z.string().optional(),
  hybrid: z.boolean().optional(),
  policy_regex_filter: z.string().optional(),
  no_alert: z.boolean().optional(),
  include_all_proxies: z.boolean().optional(),
  include_other_group: z.string().optional(), // [S] alternate way

  // [C] clash-only
  lazy: z.boolean().optional(),
  disable_udp: z.boolean().optional(),
  use: z.array(z.string()).optional(), // proxy-provider ids

  // [S] ssid params
  ssid_params: z
    .object({
      default: z.string().optional(),
      cellular: z.string().optional(),
      wifi: z.record(z.string()).optional(),
    })
    .optional(),
});

/**
 * 旧字段 → 新字段 的透明迁移:
 *   selector.include_other_group: [name, ...]  →  nested_groups: [name, ...]
 *
 * 注意:旧 UI 实际上把 group **id** 写进了 selector.include_other_group(命名设计错误,
 * 后端在 generator 直接当 group name 用,id≠name 时会触发客户端 "proxy not found")。
 * 这里不查 id→name 映射(避免 Repo.readById 循环依赖),直接搬值;
 * 如果用户的 id≠name,迁移后的 nested_groups 仍会是 id,会被
 * `validateGroupRefs` 标为 dangling → 用户能看到 warning 后自行修正成 name。
 * 用户的 id 通常 = name(默认模板就是这样),所以这种简化在绝大多数场景下都正确。
 */
export const proxyGroupSchema = proxyGroupBaseSchema.transform((data) => {
  const legacy = data.selector?.include_other_group ?? [];
  if (legacy.length === 0) return data;
  // 去重合并,保留 nested_groups 现有值在前(用户在新 UI 显式加的优先于隐式迁移)
  const merged = Array.from(new Set([...data.nested_groups, ...legacy]));
  return {
    ...data,
    nested_groups: merged,
    selector: data.selector ? { ...data.selector, include_other_group: [] } : undefined,
  };
});

export type ProxyGroup = z.infer<typeof proxyGroupSchema>;
