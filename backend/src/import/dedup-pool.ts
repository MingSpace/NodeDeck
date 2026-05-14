import { createHash } from "node:crypto";
import type { Node } from "../schemas/node.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { SurgeModule } from "../schemas/surge-module.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import { nodeIdentity } from "../parsers/dedup.js";

export interface DedupResult<T> {
  /** 待写入的去重后条目;已带 identity 的副本不会重复出现。 */
  kept: T[];
  /** 在 pool 或 toImport 自身中已经存在等价物,被跳过的条目。 */
  duplicates: T[];
}

/**
 * 把待导入条目跟已有池子按指定 identity 函数去重。
 *
 * 不变量:
 * - identity 一致 ⇒ 视为同一条目,后到的被丢弃(同一份文件再次导入是幂等的)。
 * - 同时清除 toImport 内部自身重复(同 key 多次出现保留第一条)。
 *
 * 对节点保留旧名 `dedupAgainstPool` 作为 thin wrapper,避免破坏既有 import 流程的 API。
 */
export function dedupBy<T>(
  toImport: T[],
  pool: T[],
  identity: (x: T) => string,
): DedupResult<T> {
  const seen = new Set<string>();
  for (const x of pool) seen.add(identity(x));

  const kept: T[] = [];
  const duplicates: T[] = [];

  for (const x of toImport) {
    const key = identity(x);
    if (seen.has(key)) {
      duplicates.push(x);
    } else {
      seen.add(key);
      kept.push(x);
    }
  }
  return { kept, duplicates };
}

/**
 * 节点池去重(向后兼容旧调用点)。身份 key 与 generator 出口的 `dedupeNodes` 一致。
 */
export function dedupAgainstPool(toImport: Node[], pool: Node[]): DedupResult<Node> {
  return dedupBy(toImport, pool, nodeIdentity);
}

// ---------- 各实体的 identity 函数 ----------
//
// 设计原则:
// 1. identity 由"语义关键字段"组成,不掺入仅 UI 用途字段(name/description/id)。
//    这样同一份文件二次导入(name 由文件名生成、id 由 slug 生成)能命中已存在条目。
// 2. 输入时机:`importClashYaml` / `importSurgeConf` 还没过 zod schema,所以字段可能
//    为 undefined;identity 函数必须对 undefined 容错(用 ?? "" 兜底)。
// 3. 哈希用 sha1 截断,只是为了得到稳定字符串;不需要密码学强度。

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex").slice(0, 16);
}

function stableJson(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${k}:${stableJson(obj[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * RuleSet identity:
 * - remote_url 走 type|url|behavior|format|policy 组合(同 URL 不同 policy 视为两条规则块)
 * - inline_list 加入 payload(排序后哈希)
 * - geosite/geoip 走分类码 + policy
 *
 * 故意不包含 surge_flags / surge_reject_options 等"导出风格"字段:用户对同一份资源
 * 的两次导入只会拿到完全一致的 flags(由 importer 推断),不会区分。
 */
export function rulesetIdentity(r: Partial<RuleSet>): string {
  const parts = [
    r.type ?? "remote_url",
    r.url ?? "",
    r.behavior ?? "",
    r.format ?? "",
    r.policy ?? "",
    r.geosite_category ?? "",
    r.geoip_country_code ?? "",
    // surge_internal 同名(SYSTEM/LAN)挂同 policy 视为同一条;
    // 不同 policy 应被视为两条 ruleset,所以 policy 已经在上面参与了 identity。
    r.surge_internal_name ?? "",
    (r.payload ?? []).slice().sort().join("\n"),
  ];
  return sha1(parts.join("|"));
}

/**
 * ProxyGroup identity:
 * - name + type + 排序后的成员列表。
 * - 成员排序不影响身份,但实际导入时会保留 toImport 的原顺序。
 * - 故意不带 url/interval/timeout 等测速参数,因为同一组重复导入时这些值会一致。
 */
export function proxyGroupIdentity(g: Partial<ProxyGroup>): string {
  const parts = [
    g.name ?? "",
    g.type ?? "select",
    (g.proxies ?? []).slice().sort().join(","),
  ];
  return sha1(parts.join("|"));
}

/**
 * SurgeModule identity: name + 全部 content_sections 文本(按 section 名排序后拼接)。
 * 文件没改动 ⇒ 内容字符串一致 ⇒ 同一身份。
 */
export function surgeModuleIdentity(m: Partial<SurgeModule>): string {
  const sections = m.content_sections ?? {};
  const keys = Object.keys(sections).sort();
  const blob = keys.map((k) => `${k}:::${(sections as Record<string, string | undefined>)[k] ?? ""}`).join("\n---\n");
  return sha1(`${m.name ?? ""}|${blob}`);
}

/**
 * GeneralPreset identity: 哈希除 id/name 外的全部字段。
 * 这样同一份 .conf / yaml 二次导入,即便 file_name 相同 ⇒ name 相同,
 * 真正驱动去重的是底下的 dns / mitm / http_listen 等设置。
 */
export function generalPresetIdentity(g: Partial<GeneralPreset>): string {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(g)) {
    if (k === "id" || k === "name") continue;
    rest[k] = v;
  }
  return sha1(stableJson(rest));
}
