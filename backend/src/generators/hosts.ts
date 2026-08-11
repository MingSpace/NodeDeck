/**
 * hosts 双端兼容工具。
 *
 * `general.hosts` 是 [CS] 共用字段(`Record<string, string | string[]>`),但两端语法不同:
 * - Clash(mihomo): 顶层 `hosts:` map,value 支持单 IP 字符串、IP 数组、单个域名别名(CNAME);
 *   通配符 `*`/`+`/`.`、特殊值 `lan`。不识别 Surge 的 `server:` / `DOMAIN-SET:` / `RULE-SET:` 语法。
 * - Surge: `[Host]` 段每行 `key = value`,仅支持单值;额外支持 `server:<dns>` 指定解析器
 *   (含 `server:system` / `server:syslib`),以及 key 侧 `DOMAIN-SET:` / `RULE-SET:` 批量绑定。
 *
 * 参考(目标版本: mihomo Stable / Surge):
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

/** splitClashHosts 的拆分结果。 */
export interface ClashHostsSplit {
  /** 纯 IP / CNAME,进 Clash 顶层 `hosts:`。 */
  staticHosts: Record<string, HostValue>;
  /** 含 `server:` 的条目,进 `dns.proxy-server-nameserver-policy`(域名 key -> DoH 列表)。 */
  serverPolicy: Record<string, string[]>;
}

/** Surge 通配域名 key -> mihomo DNS policy 通配 key:`*.x` -> `+.x`(域名 + 所有子域),其余原样。 */
function toClashDomainKey(key: string): string {
  const k = key.trim();
  return k.startsWith("*.") ? `+.${k.slice(2)}` : k;
}

/**
 * Surge `server:<dns>` 值 -> Clash DNS 服务器写法(目标版本 mihomo Stable):
 * - `server:system` -> `system`;`server:syslib` -> null(Clash 无等价,跳过 + warning)
 * - `server:<url/ip>` -> `<url/ip>`
 * - 与 server: 混用的非 server: 值 -> null(Clash policy 仅接受解析器,跳过 + warning)
 */
function serverValueToClashDns(value: string, key: string, warnings: string[]): string | null {
  const v = value.trim();
  if (!v.toLowerCase().startsWith("server:")) {
    warnings.push(
      `Host "${key}" 的值 "${v}" 与 server: 混用,Clash proxy-server-nameserver-policy 仅接受 DNS 解析器,已忽略该值`,
    );
    return null;
  }
  const rest = v.slice("server:".length).trim();
  if (rest.toLowerCase() === "syslib") {
    warnings.push(`Host "${key}" 的 server:syslib 在 Clash 无等价,已忽略该值`);
    return null;
  }
  return rest;
}

/**
 * 把合并后的 hosts 拆成 Clash 两条通路:含 `server:` 的条目投到
 * `dns.proxy-server-nameserver-policy`(按域名匹配,多机场不串台);其余(纯 IP / CNAME /
 * `DOMAIN-SET:` / `RULE-SET:`)交给 `buildClashHosts`(后两者无 Clash 等价,跳过 + warning)。
 */
export function splitClashHosts(
  hosts: Record<string, HostValue>,
  warnings: string[],
): ClashHostsSplit {
  const serverPolicy: Record<string, string[]> = {};
  const rest: Record<string, HostValue> = {};
  for (const [key, raw] of Object.entries(hosts)) {
    const values = normalizeHostValue(raw);
    if (values.length === 0) continue;
    const upperKey = key.trim().toUpperCase();
    const isBatch = upperKey.startsWith("DOMAIN-SET:") || upperKey.startsWith("RULE-SET:");
    const hasServer = values.some((v) => v.trim().toLowerCase().startsWith("server:"));
    if (!isBatch && hasServer) {
      const policyKey = toClashDomainKey(key);
      const list = serverPolicy[policyKey] ?? (serverPolicy[policyKey] = []);
      for (const v of values) {
        const dns = serverValueToClashDns(v, key, warnings);
        if (dns && !list.includes(dns)) list.push(dns);
      }
      if (list.length === 0) delete serverPolicy[policyKey];
      continue;
    }
    rest[key] = raw;
  }
  return { staticHosts: buildClashHosts(rest, warnings), serverPolicy };
}
