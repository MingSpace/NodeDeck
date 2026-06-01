/**
 * hosts 双端兼容工具。
 *
 * `general.hosts` 是 [CS] 共用字段(`Record<string, string | string[]>`),但两端语法不同:
 * - Clash(mihomo): 顶层 `hosts:` map,value 支持单 IP 字符串、IP 数组、单个域名别名(CNAME);
 *   通配符 `*`/`+`/`.`、特殊值 `lan`。不识别 Surge 的 `server:` / `DOMAIN-SET:` / `RULE-SET:` 语法。
 * - Surge: `[Host]` 段每行 `key = value`,仅支持单值;额外支持 `server:<dns>` 指定解析器
 *   (含 `server:system` / `server:syslib`),以及 key 侧 `DOMAIN-SET:` / `RULE-SET:` 批量绑定。
 *
 * 参考(目标版本: mihomo Stable / Surge 5):
 * - mihomo docs/config.yaml `hosts` 段 + config.go `parseHosts`(`NewHostValue` 接受 string 或数组,
 *   支持 `domain: [ip1, ip2]`)
 * - Surge manual Local DNS Mapping: https://manual.nssurge.com/dns/local-dns-mapping.html
 */

export type HostValue = string | string[];

/** 把 host value 规整成字符串数组:数组原样(trim 去空);字符串按逗号拆分。 */
export function normalizeHostValue(value: HostValue): string[] {
  const arr = Array.isArray(value) ? value : value.split(",");
  return arr.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * 判断某条 host 是否使用了 Surge 专属语法(Clash 无法识别):
 * - key 以 `DOMAIN-SET:` / `RULE-SET:` 开头(批量绑定)
 * - 任一 value 以 `server:` 开头(指定 DNS 解析器,含 `server:system` / `server:syslib`)
 */
export function isSurgeOnlyHostEntry(key: string, values: string[]): boolean {
  const k = key.trim().toUpperCase();
  if (k.startsWith("DOMAIN-SET:") || k.startsWith("RULE-SET:")) return true;
  return values.some((v) => v.trim().toLowerCase().startsWith("server:"));
}

/**
 * 构造 Clash 顶层 `hosts` map。Surge 专属语法条目跳过并发 warning;
 * 单值输出字符串,多值输出数组(mihomo 支持 `domain: [ip1, ip2]`)。
 */
export function buildClashHosts(
  hosts: Record<string, HostValue>,
  warnings: string[],
): Record<string, HostValue> {
  const out: Record<string, HostValue> = {};
  for (const [key, raw] of Object.entries(hosts)) {
    const values = normalizeHostValue(raw);
    if (values.length === 0) continue;
    if (isSurgeOnlyHostEntry(key, values)) {
      warnings.push(
        `Host "${key}" 使用 Surge 专属语法(server:/DOMAIN-SET:/RULE-SET:),已在 Clash 输出中跳过`,
      );
      continue;
    }
    out[key] = values.length === 1 ? values[0] : values;
  }
  return out;
}

/**
 * 构造 Surge `[Host]` 段行,每行 `key = value`。
 * 同一 key 的多个值(数组)展开成多行 —— Surge 支持给同一域名指定多个上游(server: DNS),
 * 机场常借此给代理节点域名配多个 DoH 规避封锁;多 IP 同理展开多行。
 */
export function buildSurgeHostLines(hosts: Record<string, HostValue>): string[] {
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(hosts)) {
    for (const v of normalizeHostValue(raw)) lines.push(`${key} = ${v}`);
  }
  return lines;
}

/**
 * 合并多个 host map(general + 各启用 provider)。同 key 的值去重后合并成数组,
 * 先传入的 map 优先(其值排在数组前面);空值条目跳过。
 */
export function mergeHostMaps(
  ...maps: Array<Record<string, HostValue> | undefined | null>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [key, raw] of Object.entries(map)) {
      const values = normalizeHostValue(raw);
      if (values.length === 0) continue;
      const existing = out[key] ?? (out[key] = []);
      for (const v of values) if (!existing.includes(v)) existing.push(v);
    }
  }
  return out;
}
