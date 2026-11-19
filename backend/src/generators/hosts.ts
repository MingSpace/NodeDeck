/**
 * hosts 工具:多来源 hosts 合并 + Surge `[Host]` 段输出。
 *
 * `general.hosts` / `provider.hosts` 是 `Record<string, string | string[]>`。Surge `[Host]` 段每行
 * `key = value`;额外支持 `server:<dns>` 指定解析器(含 `server:system` / `server:syslib`),
 * 以及 key 侧 `DOMAIN-SET:` / `RULE-SET:` 批量绑定。输入侧也会从机场 Clash YAML 的顶层
 * `hosts:` 解析出同形状的 map(见 import/extract-hosts.ts)。
 *
 * 参考: Surge manual Local DNS Mapping: https://manual.nssurge.com/dns/local-dns-mapping.html
 */

export type HostValue = string | string[];

/** 把 host value 规整成字符串数组:数组原样(trim 去空);字符串按逗号拆分。 */
export function normalizeHostValue(value: HostValue): string[] {
  const arr = Array.isArray(value) ? value : value.split(",");
  return arr.map((s) => s.trim()).filter((s) => s.length > 0);
}

/**
 * 构造 Surge `[Host]` 段行,每行 `key = value`。
 *
 * 同一 key 的多个值合并成**逗号列表**(`key = v1, v2`),不能拆成多行 —— 手册明确写了
 * `[Host]` 条目「自上而下求值,第一条命中即止」(manual.nssurge.com/dns/local-dns-mapping.html),
 * 拆多行的话第二行起永远不会命中,机场自建 DoH 配多上游、一个域名配多 IP 都会静默丢值。
 *
 * 多值的两种合法形态手册都给了示例:多个 IP 直接 `a.com = 1.2.3.4, 5.6.7.8`;
 * 多个 DNS 上游是 `a.com = server:8.8.8.8,1.1.1.1`(**server: 前缀只写一次**,
 * 且该写法需 iOS 5.21.0+ / Mac 6.8.0+)。
 */
export function buildSurgeHostLines(hosts: Record<string, HostValue>, warnings?: string[]): string[] {
  const lines: string[] = [];
  for (const [key, raw] of Object.entries(hosts)) {
    const values = normalizeHostValue(raw);
    if (values.length === 0) continue;
    lines.push(`${key} = ${joinSurgeHostValues(key, values, warnings)}`);
  }
  return lines;
}

const SERVER_PREFIX = "server:";

/**
 * 合并同 key 的多个值。`server:` 系列要折叠成单个前缀 + 逗号分隔的解析器列表,
 * 而不是每个值各带一个前缀 —— 后者不是手册给的语法。
 *
 * 一个 `[Host]` 条目只能是一种映射:要么给 IP / 别名,要么用 `server:` 指定解析器,
 * 两者无法写进同一行。合并多来源 hosts(general + 各 provider)时可能出现混用
 * (典型:机场 `[Host]` 里给节点域名配了别名,同时 `encrypted-dns-server` 又被
 * `deriveProviderHostOverrides` 推导成同 key 的 `server:`)。
 *
 * 此时固定保留 `server:` 而不是别名/IP,原因是二者无法靠拆成两条来兼得 —— Surge Mac
 * 实测(6.x,用 `.invalid` 域名做的对照:`a = b` + `b = <IP>`,报错为
 * "Empty DNS answer for b from servers: <上游>")确认**别名重启查找不会二次匹配
 * `[Host]`**,所以「别名 + 给别名目标配 server:」里的后一条永远命中不了,DoH 会失效、
 * 退回全局 dns-server 解析节点域名,反而丢掉抗污染。保留 `server:` 则是让机场自己的
 * DoH 直接解析原域名,别名那层间接可以安全绕过。被丢弃的值仍发 warning,避免静默。
 */
function joinSurgeHostValues(key: string, values: string[], warnings?: string[]): string {
  const servers = values.filter((v) => v.startsWith(SERVER_PREFIX));
  if (servers.length === 0) return values.join(", ");
  const dropped = values.filter((v) => !v.startsWith(SERVER_PREFIX));
  if (dropped.length > 0) {
    warnings?.push(
      `Host "${key}" 同时有 server: 解析器与普通映射(IP/别名),Surge 一个 [Host] 条目只能是一种形态,`
        + `且别名重启查找不会二次匹配 [Host],两者无法拆成两条兼得;`
        + `已按「保住 DNS 抗污染」取舍:保留 server:(用来源自带 DoH 直接解析该域名),`
        + `丢弃 [${dropped.join(", ")}](通常是机场给同一入口配的别名,绕过它不影响连通)`,
    );
  }
  const resolvers = servers.map((v) => v.slice(SERVER_PREFIX.length).trim()).filter((v) => v.length > 0);
  return `${SERVER_PREFIX}${resolvers.join(",")}`;
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
