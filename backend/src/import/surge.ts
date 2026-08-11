import { parseSurgeConf } from "../parsers/surge.js";
import { annotateNodes } from "../parsers/normalize.js";
import type { Node } from "../schemas/node.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import type { SurgeModule } from "../schemas/surge-module.js";
import { generateImportedId } from "./id.js";

export interface SurgeImportResult {
  general?: GeneralPreset;
  manualNodes: Node[];
  ruleSets: RuleSet[];
  proxyGroups: ProxyGroup[];
  modules: SurgeModule[];
  warnings: string[];
}

export function importSurgeConf(text: string, fileName?: string): SurgeImportResult {
  const warnings: string[] = [];

  const general = parseGeneralSection(text, fileName);
  // Surge 静默忽略没配合 include-all-networks 的隧道范围子开关。原样导入会撞上 general schema
  // 的依赖校验、让整包导入失败,所以按 Surge 的实际生效结果剔除掉。
  if (general && general.include_all_networks !== true) {
    const dropped = (["include_local_networks", "include_apns", "include_cellular_services"] as const).filter(
      (field) => general[field] === true,
    );
    for (const field of dropped) general[field] = undefined;
    if (dropped.length > 0) {
      warnings.push(
        `Dropped [General] ${dropped.join(", ")}: they require include-all-networks = true and are ignored by Surge otherwise.`,
      );
    }
  }

  const hostMap = parseHostSection(text);
  if (general && Object.keys(hostMap).length > 0) {
    general.hosts = { ...general.hosts, ...hostMap };
  }

  const mitmFromText = parseMitmSection(text);
  if (general && mitmFromText) {
    general.mitm = mitmFromText;
  }

  const ssidFromText = parseSsidSection(text);
  warnings.push(...ssidFromText.warnings);
  if (general && ssidFromText.rules.length > 0) {
    general.ssid_rules = [...(general.ssid_rules ?? []), ...ssidFromText.rules];
  }

  const mtprotoFromText = parseMtprotoSection(text);
  if (general && mtprotoFromText) {
    general.mtproto = mtprotoFromText;
  }

  const manualNodes = annotateNodes(parseSurgeConf(text));

  const directSkipped = countDirectPseudoNodes(text);
  if (directSkipped > 0) {
    warnings.push(
      `Skipped ${directSkipped} pseudo "direct" node line(s) in [Proxy]; DIRECT is a builtin policy and any extra parameters (e.g. interface=) are not yet preserved.`,
    );
  }

  const { ruleSets, proxyGroups, warnings: ruleWarnings } = parseRuleAndGroupSections(text);
  warnings.push(...ruleWarnings);

  const modules = extractInlineModules(text);

  return {
    general,
    manualNodes,
    ruleSets,
    proxyGroups,
    modules,
    warnings,
  };
}

export function extractSection(text: string, name: string): string | null {
  const re = new RegExp(`^\\[\\s*${name}\\s*\\]\\s*$`, "im");
  const lines = text.split(/\r?\n/);
  let inSection = false;
  const collected: string[] = [];
  for (const line of lines) {
    if (re.test(line.trim())) {
      inSection = true;
      continue;
    }
    if (inSection && /^\[.+\]\s*$/.test(line.trim())) break;
    if (inSection) collected.push(line);
  }
  return collected.length > 0 ? collected.join("\n") : null;
}

/**
 * 只在 key 真的出现在 conf 里时才落值。用于 Surge 默认 false 的可选布尔开关 ——
 * 一律 `=== "true"` 会把"上游没写"变成显式 `false`,导入结果里凭空多出一堆等于默认值的行。
 */
function optionalBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined) return undefined;
  return raw === "true";
}

function parseGeneralSection(text: string, fileName?: string): GeneralPreset | undefined {
  const body = extractSection(text, "General");
  if (!body) return undefined;
  const kv: Record<string, string> = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    kv[k] = v;
  }
  const trimmedFile = fileName?.trim();
  const ipv6Vif = kv["ipv6-vif"];
  return {
    id: generateImportedId(trimmedFile && trimmedFile.length > 0 ? trimmedFile : "surge"),
    name: `Imported from ${trimmedFile && trimmedFile.length > 0 ? trimmedFile : "Surge"}`,
    mode: "rule",
    log_level: (kv.loglevel as GeneralPreset["log_level"]) ?? "notify",
    ipv6: kv.ipv6 === "true",
    allow_lan: kv["allow-lan"] === "true" || kv["allow-wifi-access"] === "true",
    http_listen: kv["http-listen"],
    socks5_listen: kv["socks5-listen"],
    read_etc_hosts: kv["read-etc-hosts"] === "true",
    wifi_assist: kv["wifi-assist"] === "true",
    allow_hotspot_access: kv["allow-hotspot-access"] === "true",
    allow_wifi_access: kv["allow-wifi-access"] === "true",
    internet_test_url: kv["internet-test-url"],
    proxy_test_url: kv["proxy-test-url"],
    test_timeout: kv["test-timeout"] ? parseInt(kv["test-timeout"], 10) : undefined,
    proxy_test_udp: kv["proxy-test-udp"],
    udp_policy_not_supported_behaviour:
      kv["udp-policy-not-supported-behaviour"] === "REJECT" ? "REJECT" : kv["udp-policy-not-supported-behaviour"] === "DIRECT" ? "DIRECT" : undefined,
    geoip_maxmind_url: kv["geoip-maxmind-url"],
    ipv6_vif: ipv6Vif === "off" || ipv6Vif === "auto" ? ipv6Vif : undefined,
    skip_proxy: kv["skip-proxy"]?.split(",").map((s) => s.trim()),
    exclude_simple_hostnames: kv["exclude-simple-hostnames"] === "true",
    always_real_ip: kv["always-real-ip"]?.split(",").map((s) => s.trim()),
    show_error_page_for_reject: kv["show-error-page-for-reject"] === "true",
    block_quic: ["per-policy", "all-proxy", "all", "always-allow"].includes(kv["block-quic"])
      ? (kv["block-quic"] as GeneralPreset["block_quic"])
      : undefined,
    include_all_networks: optionalBool(kv["include-all-networks"]),
    include_local_networks: optionalBool(kv["include-local-networks"]),
    include_apns: optionalBool(kv["include-apns"]),
    include_cellular_services: optionalBool(kv["include-cellular-services"]),
    http_api: parseHttpApi(kv),
    dns: {
      enable: true,
      server: kv["dns-server"]?.split(",").map((s) => s.trim()),
      encrypted_server: kv["encrypted-dns-server"]?.split(",").map((s) => s.trim()),
      hijack: kv["hijack-dns"]?.split(",").map((s) => s.trim()),
    },
  };
}

/**
 * 解析 `http-api = key@ip:port`(https://manual.nssurge.com/profile/general.html)。
 * 手册里 key 是一整串不可再切分的密钥,没有用户名概念,所以 `@` 之前的部分整串当
 * password —— 任何按 `:` / `^` 拆再拼回的做法都会让 key 静默改变,Surge 侧 X-Key 失配。
 * listen 用 `lastIndexOf('@')` 切,避免 key 里含 `@` 时崩。
 *
 * `http-api-tls` 用户在 conf 里写错成 `flase` 是常见现象;这里只把字面 "true" 当 true,
 * 其它一律 false,与 Surge 客户端宽松行为对齐。
 */
function parseHttpApi(kv: Record<string, string>): GeneralPreset["http_api"] | undefined {
  const raw = kv["http-api"];
  if (!raw) return undefined;
  const atIdx = raw.lastIndexOf("@");
  if (atIdx <= 0) return undefined;
  const listen = raw.slice(atIdx + 1).trim();
  if (!listen) return undefined;
  return {
    password: raw.slice(0, atIdx),
    listen,
    web_dashboard: kv["http-api-web-dashboard"] === "true",
    tls: kv["http-api-tls"] === "true",
  };
}

export function parseHostSection(text: string): Record<string, string | string[]> {
  const body = extractSection(text, "Host");
  if (!body) return {};
  const out: Record<string, string | string[]> = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (!k || !v) continue;
    // Surge [Host] 允许同一域名多行(如多个 server: 上游 DNS),累积成数组保真。
    const existing = out[k];
    if (existing === undefined) out[k] = v;
    else if (Array.isArray(existing)) existing.push(v);
    else out[k] = [existing, v];
  }
  return out;
}

function parseMitmSection(text: string): GeneralPreset["mitm"] | undefined {
  const body = extractSection(text, "MITM");
  if (!body) return undefined;
  const kv: Record<string, string> = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    kv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  if (Object.keys(kv).length === 0) return undefined;
  return {
    enable: kv.enable === "true",
    hostname: kv.hostname?.split(",").map((s) => s.trim()) ?? [],
    h2: kv.h2 !== "false",
    tcp_connection: kv["tcp-connection"] === "true",
    skip_server_cert_verify: kv["skip-server-cert-verify"] === "true",
    ca_p12: kv["ca-p12"],
    ca_passphrase: kv["ca-passphrase"],
  };
}

/**
 * 解析 Surge `[MTProto]` 段(Telegram 入站代理,manual.nssurge.com/others/mtproto.html)。
 * 与 generator 端对称;conf 中出现该段即视为启用(Surge 本身没有 enable 键)。
 * interface/port 缺失时用 Surge 文档示例的缺省值兜底,secret 缺失保留空串
 * (generator 端会因 secret 不合法跳过输出 + warning,不静默生成坏配置)。
 */
function parseMtprotoSection(text: string): GeneralPreset["mtproto"] | undefined {
  const body = extractSection(text, "MTProto");
  if (!body) return undefined;
  const kv: Record<string, string> = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    kv[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  if (Object.keys(kv).length === 0) return undefined;
  const port = kv.port ? parseInt(kv.port, 10) : NaN;
  return {
    enable: true,
    interface: kv.interface ?? "127.0.0.1",
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 5753,
    secret: kv.secret ?? "",
    ipv6: kv.ipv6 === "true" ? true : kv.ipv6 === "false" ? false : undefined,
    dc_config_url: kv["dc-config-url"],
  };
}

type SsidRule = NonNullable<GeneralPreset["ssid_rules"]>[number];

const CELLULAR_FALLBACK_VALUES = ["default", "off", "wifi-assist", "hybrid"] as const;
const TFO_BEHAVIOUR_VALUES = ["auto", "force-enabled", "force-disabled"] as const;
/** 值本身也是逗号分隔的参数 —— 后续没有 `=` 的 token 都算它的续值 */
const SSID_LIST_PARAMS = new Set(["dns-server", "encrypted-dns-server"]);

/**
 * 解析 Surge `[SSID Setting]` 段(官方文档名 Subnet Settings,
 * https://manual.nssurge.com/features/subnet-settings.html):
 *
 *   <subnet 表达式> key=value,key=value
 *
 * 表达式可以是 `SSID:` / `BSSID:` / `ROUTER:` / `TYPE:` / `MCCMNC:` 前缀形式,或 legacy 裸值;
 * 含空格时整个表达式用双引号包起来。参数官方是逗号分隔,这里也接受空格分隔 —— NodeDeck
 * 早期版本自己就是空格拼的,回读老产物不能丢字段。
 *
 * 与 generator 端 `buildSubnetSettingLines` 严格对称。刻意不认的两类行:
 * - `policy=` —— 手册里本段从来没有这个参数(按网络选策略是 subnet 组 / `SUBNET` 规则的事),
 *   NodeDeck 早期错误地生成过它,回读时给 warning 并丢弃
 * - `default = Proxy` / `cellular=Auto` 这种纯 `key=value` 行 —— 那是 subnet 策略组的组内参数,
 *   写进本段是配置写错了,给 warning 而不是静默吞掉
 */
function parseSsidSection(text: string): { rules: SsidRule[]; warnings: string[] } {
  const body = extractSection(text, "SSID Setting");
  const warnings: string[] = [];
  if (!body) return { rules: [], warnings };
  const rules: SsidRule[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;

    const quoted = line.match(/^"([^"]*)"\s*(.*)$/);
    const bare = quoted ? null : line.match(/^(\S+)(?:\s+(.*))?$/);
    const expr = quoted ? quoted[1].trim() : (bare?.[1] ?? "");
    const paramsPart = (quoted ? quoted[2] : (bare?.[2] ?? "")).trim();
    if (expr === "") continue;
    if (expr.includes("=") || paramsPart.startsWith("=")) {
      warnings.push(`[SSID Setting] 跳过 "${line}":这是策略组的参数写法,本段每行要以网络匹配表达式开头`);
      continue;
    }

    const rule: SsidRule = { match: normalizeSubnetExpression(expr) };
    let listKey: string | undefined;
    for (const tok of paramsPart.split(/[,\s]+/).filter(Boolean)) {
      const eq = tok.indexOf("=");
      if (eq <= 0) {
        // 没有 `=` 的 token:要么是列表参数的续值(dns-server=a,b),要么就是写错了
        if (listKey === "dns-server") rule.dns_server = [...(rule.dns_server ?? []), tok];
        else if (listKey === "encrypted-dns-server") {
          rule.encrypted_dns_server = [...(rule.encrypted_dns_server ?? []), tok];
        } else warnings.push(`[SSID Setting] "${expr}" 的 "${tok}" 不是 key=value,已忽略`);
        continue;
      }
      const key = tok.slice(0, eq).trim().toLowerCase();
      const value = tok.slice(eq + 1).trim();
      listKey = SSID_LIST_PARAMS.has(key) ? key : undefined;
      switch (key) {
        case "suspend":
        case "cellular-mode": {
          if (value !== "true" && value !== "false") {
            warnings.push(`[SSID Setting] "${expr}" 的 ${key}=${value} 不是布尔值,已忽略`);
            break;
          }
          if (key === "suspend") rule.suspend = value === "true";
          else rule.cellular_mode = value === "true";
          break;
        }
        case "cellular-fallback": {
          const v = value.toLowerCase();
          if (!(CELLULAR_FALLBACK_VALUES as readonly string[]).includes(v)) {
            warnings.push(`[SSID Setting] "${expr}" 的 cellular-fallback=${value} 不是合法取值,已忽略`);
            break;
          }
          rule.cellular_fallback = v as SsidRule["cellular_fallback"];
          break;
        }
        // 手册只有英式 tfo-behaviour,美式拼写一并容错(用户手敲高频错法)
        case "tfo-behaviour":
        case "tfo-behavior": {
          const v = value.toLowerCase();
          if (!(TFO_BEHAVIOUR_VALUES as readonly string[]).includes(v)) {
            warnings.push(`[SSID Setting] "${expr}" 的 tfo-behaviour=${value} 不是合法取值,已忽略`);
            break;
          }
          rule.tfo_behaviour = v as SsidRule["tfo_behaviour"];
          break;
        }
        case "dns-server":
          rule.dns_server = [...(rule.dns_server ?? []), value];
          break;
        case "encrypted-dns-server":
          rule.encrypted_dns_server = [...(rule.encrypted_dns_server ?? []), value];
          break;
        case "policy":
          warnings.push(
            `[SSID Setting] "${expr}" 的 policy=${value} 已丢弃:本段没有 policy 参数,`
              + `按网络切策略请用 subnet 策略组或 SUBNET 规则`,
          );
          break;
        default:
          warnings.push(`[SSID Setting] "${expr}" 的参数 ${key} 不是本段支持的键,已忽略`);
      }
    }
    rules.push(rule);
  }
  return { rules, warnings };
}

/**
 * 表达式前缀统一成大写(Surge 认的是 `SSID:` 这种写法,但用户手敲常见小写);
 * `TYPE:` 的取值也一并大写。裸值(legacy 兼容写法)原样保留 —— 它比对的是
 * SSID / BSSID / 网关 IP,大小写有语义。
 */
function normalizeSubnetExpression(expr: string): string {
  const m = expr.match(/^(SSID|BSSID|ROUTER|TYPE|MCCMNC):(.*)$/i);
  if (!m) return expr;
  const prefix = m[1].toUpperCase();
  return `${prefix}:${prefix === "TYPE" ? m[2].toUpperCase() : m[2]}`;
}

function parseRuleAndGroupSections(text: string): {
  ruleSets: RuleSet[];
  proxyGroups: ProxyGroup[];
  warnings: string[];
} {
  const warnings: string[] = [];
  const ruleSets: RuleSet[] = [];
  const proxyGroups: ProxyGroup[] = [];

  const rulesBody = extractSection(text, "Rule");
  if (rulesBody) {
    for (const raw of rulesBody.split(/\r?\n/)) {
      const line = stripComment(raw).trim();
      if (!line) continue;
      // Surge 文档: RULE-SET (含子规则集) 与 DOMAIN-SET (纯域名表) 共用前缀,语义不同。
      // mihomo 端 DomainTrie 同时支持 `.example.com` 与 `+.example.com` 前缀,
      // 所以 Surge DOMAIN-SET 文件可直接通过 mihomo `behavior: domain` + `format: text` 消费。
      const setMatch = line.match(/^(RULE-SET|DOMAIN-SET)\s*,\s*([^,]+)\s*,\s*([A-Za-z0-9-_+]+)/i);
      if (!setMatch) continue;
      const setKind = setMatch[1].toUpperCase() as "RULE-SET" | "DOMAIN-SET";
      const urlOrName = setMatch[2].trim();
      const policy = setMatch[3].trim();
      // Surge 内置 ruleset SYSTEM / LAN(`RULE-SET,SYSTEM,DIRECT` / `RULE-SET,LAN,DIRECT`):
      // 两个平台共有,文档见 manual.nssurge.com/rule/ruleset.html#internal-ruleset。
      // 解析成 type=surge_internal 的 ruleset,留给 Surge generator 原样输出、Clash generator
      // 自行处理(LAN 展开/SYSTEM 跳过)。
      if (
        setKind === "RULE-SET"
        && !urlOrName.startsWith("http")
        && (urlOrName === "SYSTEM" || urlOrName === "LAN")
      ) {
        const id = generateImportedId(`rule-${urlOrName.toLowerCase()}`);
        const flagsPart = line.slice(setMatch[0].length).split(",").map((s) => s.trim());
        const flags: RuleSet["surge_flags"] = {};
        for (const f of flagsPart) {
          if (!f) continue;
          if (f === "no-resolve") flags.no_resolve = true;
          else if (f === "extended-matching") flags.extended_matching = true;
          else if (f === "pre-matching") flags.pre_matching = true;
          else if (f === "force-remote-dns") flags.force_remote_dns = true;
        }
        ruleSets.push({
          id,
          name: urlOrName,
          type: "surge_internal",
          surge_internal_name: urlOrName,
          behavior: "classical",
          format: "text",
          policy,
          surge_flags: Object.keys(flags).length > 0 ? flags : undefined,
          clash_format: "rule_provider",
          surge_format: "rule_set",
          update_interval: 86400,
        });
        continue;
      }
      if (!urlOrName.startsWith("http")) continue; // 其它非 http 引用暂不支持
      const url = urlOrName;
      // id 中保留 "rule" / "domainset" 前缀语义,文件名形如
      // imported-rule-cn-abc123.yaml / imported-domainset-cn-abc123.yaml,
      // 与旧版 imported-rule-N / imported-domainset-N 保持视觉相似但不再依赖计数器。
      const ruleSlug = deriveRuleName(url);
      const id = generateImportedId(
        setKind === "DOMAIN-SET" ? `domainset-${ruleSlug}` : `rule-${ruleSlug}`,
      );
      const flagsPart = line.slice(setMatch[0].length).split(",").map((s) => s.trim());
      const flags: RuleSet["surge_flags"] = {};
      let rejectType: "REJECT" | "REJECT-DROP" | "REJECT-NO-DROP" | "REJECT-TINYGIF" | undefined;
      if (/^REJECT-?(DROP|NO-DROP|TINYGIF)?$/.test(policy)) {
        rejectType = policy as typeof rejectType;
      }
      let notificationText: string | undefined;
      let notificationInterval: number | undefined;
      for (const f of flagsPart) {
        if (!f) continue;
        if (f === "no-resolve") flags.no_resolve = true;
        else if (f === "extended-matching") flags.extended_matching = true;
        else if (f === "pre-matching") flags.pre_matching = true;
        else if (f === "force-remote-dns") flags.force_remote_dns = true;
        else if (f.includes("notification-text")) {
          const m = f.match(/notification-text\s*=\s*"?([^"]*)"?/);
          if (m) notificationText = m[1];
        } else if (f.includes("notification-interval")) {
          const m = f.match(/notification-interval\s*=\s*(\d+)/);
          if (m) notificationInterval = parseInt(m[1], 10);
        }
      }
      ruleSets.push({
        id,
        name: deriveRuleName(url),
        type: "remote_url",
        url,
        // RULE-SET 文件可含混合规则,mihomo 端只能用 behavior=classical;
        // DOMAIN-SET 文件每行一个域名,mihomo 端用 behavior=domain。
        behavior: setKind === "DOMAIN-SET" ? "domain" : "classical",
        format: detectRulesetFormatFromUrl(url),
        policy: rejectType ? "REJECT" : policy,
        surge_flags: Object.keys(flags).length > 0 ? flags : undefined,
        surge_reject_options: rejectType
          ? { type: rejectType, notification_text: notificationText, notification_interval: notificationInterval }
          : undefined,
        clash_format: "rule_provider",
        surge_format: setKind === "DOMAIN-SET" ? "domain_set" : "rule_set",
        update_interval: 86400,
      });
    }
  }

  const groupBody = extractSection(text, "Proxy Group");
  if (groupBody) {
    for (const raw of groupBody.split(/\r?\n/)) {
      const line = stripComment(raw).trim();
      if (!line || !line.includes("=")) continue;
      const eqIdx = line.indexOf("=");
      const name = line.slice(0, eqIdx).trim();
      const rhs = line.slice(eqIdx + 1).trim();
      const parts = rhs.split(",").map((s) => s.trim());
      if (parts.length < 2) continue;
      const type = parts[0];
      const proxies: string[] = [];
      const params: Record<string, string> = {};
      for (let i = 1; i < parts.length; i++) {
        const p = parts[i];
        if (p.includes("=")) {
          const idx = p.indexOf("=");
          params[p.slice(0, idx).trim()] = p.slice(idx + 1).trim();
        } else {
          proxies.push(p);
        }
      }
      proxyGroups.push({
        id: generateImportedId(name),
        name,
        type: ["select", "url-test", "fallback", "load-balance", "smart", "ssid", "external"].includes(type as string)
          ? (type as ProxyGroup["type"])
          : "select",
        proxies,
        // Surge 导入侧暂不主动识别嵌套组(.conf 里的组成员段不区分节点名/组名);
        // 留空数组让后续 schema parse 直通。用户想拆分可在 Web UI 编辑该组时手动操作。
        nested_groups: [],
        url: params.url,
        interval: params.interval ? parseInt(params.interval, 10) : undefined,
        tolerance: params.tolerance ? parseInt(params.tolerance, 10) : undefined,
        timeout: params.timeout ? parseInt(params.timeout, 10) : undefined,
      });
    }
  }

  return { ruleSets, proxyGroups, warnings };
}

function countDirectPseudoNodes(text: string): number {
  const body = extractSection(text, "Proxy");
  if (!body) return 0;
  let count = 0;
  for (const raw of body.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 0) continue;
    const rhs = line.slice(eqIdx + 1).trim();
    const firstToken = rhs.split(",")[0]?.trim().toLowerCase();
    if (firstToken === "direct") count++;
  }
  return count;
}

function extractInlineModules(text: string): SurgeModule[] {
  const sections: Record<string, string> = {};
  for (const name of ["URL Rewrite", "Header Rewrite", "Body Rewrite", "Script"]) {
    const body = extractSection(text, name);
    if (body) sections[name] = body.trim();
  }
  if (Object.keys(sections).length === 0) return [];
  return [
    {
      id: generateImportedId("module"),
      name: "Imported Module",
      description: "Module sections imported from Surge .conf",
      content_sections: {
        url_rewrite: sections["URL Rewrite"],
        header_rewrite: sections["Header Rewrite"],
        body_rewrite: sections["Body Rewrite"],
        script: sections["Script"],
      },
    },
  ];
}

export function stripComment(line: string): string {
  for (const c of ["#", ";"]) {
    const i = line.indexOf(c);
    if (i >= 0) return line.slice(0, i);
  }
  // // is a comment marker only at line start or after whitespace
  // (otherwise it's part of a URL like https://, quic://)
  const i = line.indexOf("//");
  if (i === 0 || (i > 0 && /\s/.test(line[i - 1]))) {
    return line.slice(0, i);
  }
  return line;
}

function deriveRuleName(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "rule";
    return last.replace(/\.[^.]+$/, "");
  } catch {
    return "rule";
  }
}

// 按 URL 后缀推断 mihomo `format` 字段。绝大多数 Surge 风格 list (.list/.conf)
// 实际是 plain text,只有原生 mihomo 资源才用 .yaml/.yml/.mrs。
function detectRulesetFormatFromUrl(url: string): "yaml" | "text" | "mrs" {
  try {
    const path = new URL(url).pathname.toLowerCase();
    if (path.endsWith(".yaml") || path.endsWith(".yml")) return "yaml";
    if (path.endsWith(".mrs")) return "mrs";
    return "text";
  } catch {
    return "text";
  }
}
