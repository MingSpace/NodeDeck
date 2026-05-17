import type { Node } from "../schemas/node.js";
import type { Profile } from "../schemas/profile.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import type { SurgeModule } from "../schemas/surge-module.js";
import { applyNodeFilter } from "./node-filter.js";
import { applyChainRules, validateChain } from "../chain/apply.js";
import { uniquifyNodeNames, escapeSurgeNames } from "./node-naming.js";
import { validateGroupRefs } from "./group-refs.js";
import { REJECT_TYPE_MAP } from "./protocol-mapping.js";

export interface SurgeGenerateInput {
  profile: Profile;
  nodes: Node[];
  groups: ProxyGroup[];
  rules: { ref: string; policy: string; ruleset: RuleSet }[];
  finalRule?: { policy: string; dns_failed?: boolean };
  geoipFallback?: { policy: string };
  general?: GeneralPreset;
  surgeModules: SurgeModule[];
  managed_config_url?: string;
  warnings: string[];
  // 系统中所有 group 的 name 集合,仅供 validateGroupRefs 做"组未引入"诊断;
  // 不传则退化为旧行为(所有未知引用都归入 nodeDangling)。
  allKnownGroupNames?: Set<string>;
}

export function generateSurgeConfig(input: SurgeGenerateInput): string {
  const { profile, general } = input;
  const filtered = applyNodeFilter(input.nodes, profile.node_filter);
  const uniqued = uniquifyNodeNames(filtered, input.warnings);
  // Surge 专属:把 = , " 等会破坏 INI 行解析的字符替换掉,且同步改写所有引用。
  const escaped = escapeSurgeNames(uniqued, input.groups, input.warnings);
  const chained = applyChainRules(escaped.nodes, profile);
  const groupNames = new Set(escaped.groups.map((g) => g.name));
  const filteredNodes = validateChain(chained, { groupNames, warnings: input.warnings });
  // 清理 group.proxies 中悬空的节点名(被 node_filter 过滤掉但 group 仍显式引用的)
  const sanitizedGroups = validateGroupRefs(escaped.groups, filteredNodes, {
    warnings: input.warnings,
    allKnownGroupNames: input.allKnownGroupNames,
  });
  // Surge generator 的整体结构:先把 [General]/[Proxy]/.../[MITM] 等段写进 body,
  // 期间 generator 内部组件(如 buildSurgeWireGuardSection)会向 input.warnings 追加诊断。
  // 全部生成完后才把 header(含 # WARN: ...)拼到最前面 — 否则 wireguard section
  // 在主循环更后面才被构造,新产生的 warnings 会被早期固化的 header 漏掉。
  const lines: string[] = [];

  // [General] section: merge general preset + module general fragments
  lines.push("[General]");
  if (general) {
    appendGeneralLines(lines, general);
  }
  for (const m of input.surgeModules) {
    if (m.content_sections.general) {
      lines.push(...splitNonEmpty(m.content_sections.general));
    }
  }
  lines.push("");

  // [Host]
  if ((general?.hosts && Object.keys(general.hosts).length > 0) || hasModuleSection(input.surgeModules, "host")) {
    lines.push("[Host]");
    if (general?.hosts) {
      for (const [k, v] of Object.entries(general.hosts)) lines.push(`${k} = ${v}`);
    }
    for (const m of input.surgeModules) {
      if (m.content_sections.host) lines.push(...splitNonEmpty(m.content_sections.host));
    }
    lines.push("");
  }

  // [SSID Setting]
  if (general?.ssid_rules && general.ssid_rules.length > 0) {
    lines.push("[SSID Setting]");
    for (const r of general.ssid_rules) {
      const parts: string[] = [];
      if (r.suspend) parts.push(`suspend=${r.suspend}`);
      if (r.policy) parts.push(`policy=${r.policy}`);
      lines.push(`SSID:${r.ssid} ${parts.join(" ")}`.trim());
    }
    lines.push("");
  }

  // [Proxy]
  // wireguard 走特殊路径:[Proxy] 段只放 `name = wireguard, section-name=<id>` 一行,
  // 密钥 / 自身 IP / peer 写在文件后面单独的 [WireGuard <id>] 段。
  lines.push("[Proxy]");
  lines.push("DIRECT = direct");
  const wgSections: string[][] = [];
  filteredNodes.forEach((node, idx) => {
    if (node.type === "wireguard") {
      const sid = sanitizeWireGuardSectionId(node.name, idx + 1);
      const head = `${node.name} = wireguard, section-name=${sid}`;
      // wireguard 在 Surge 端不接受 underlying-proxy / udp-relay 这些通用参数 — 它本身就是 L3 隧道
      if (node.chain_via) {
        input.warnings.push(
          `Surge wireguard "${node.name}" chain_via="${node.chain_via}" 在 Surge 端不被支持(L3 隧道无法叠 underlying-proxy),已忽略`,
        );
      }
      lines.push(head);
      wgSections.push(buildSurgeWireGuardSection(sid, node, input.warnings));
      return;
    }
    const line = buildSurgeProxyLine(node, input.warnings);
    if (line) lines.push(line);
  });
  lines.push("");

  // [Proxy Group]
  if (sanitizedGroups.length > 0) {
    lines.push("[Proxy Group]");
    for (const g of sanitizedGroups) {
      lines.push(buildSurgeProxyGroup(g, filteredNodes));
    }
    lines.push("");
  }

  // [Rule]
  lines.push("[Rule]");
  // For inline_ruleset format, we collect them into a separate section header to emit later
  const inlineRulesets: { name: string; payload: string[] }[] = [];
  for (const r of input.rules) {
    const rs = r.ruleset;
    const flags: string[] = [];
    if (rs.surge_flags) {
      if (rs.surge_flags.no_resolve) flags.push("no-resolve");
      if (rs.surge_flags.extended_matching) flags.push("extended-matching");
      if (rs.surge_flags.pre_matching) flags.push("pre-matching");
      if (rs.surge_flags.force_remote_dns) flags.push("force-remote-dns");
    }
    let policy = r.policy;
    let extraParams: string[] = [];
    if (rs.surge_reject_options) {
      const subtype = rs.surge_reject_options.type;
      const mapped = REJECT_TYPE_MAP[subtype];
      if (mapped?.surge) policy = mapped.surge;
      if (rs.surge_reject_options.notification_text) {
        extraParams.push(`'notification-text="${rs.surge_reject_options.notification_text}"'`);
      }
      if (rs.surge_reject_options.notification_interval !== undefined) {
        extraParams.push(`'notification-interval=${rs.surge_reject_options.notification_interval}'`);
      }
    }

    const flagSuffix = flags.length ? "," + flags.join(",") : "";
    // 分发顺序:按 rs.type 优先,surge_format 仅在同 type 内部决定细节。
    if (rs.type === "remote_url") {
      if (!rs.url) {
        input.warnings.push(`Ruleset "${rs.id}" type=remote_url but url missing, skipped`);
        continue;
      }
      if (rs.surge_format === "domain_set") {
        lines.push(`DOMAIN-SET,${rs.url},${policy}${flagSuffix}`);
      } else {
        const parts = [`RULE-SET,${rs.url}`, policy, ...extraParams, ...flags];
        lines.push(parts.join(","));
      }
    } else if (rs.type === "inline_list") {
      if (!rs.payload || rs.payload.length === 0) {
        input.warnings.push(`Ruleset "${rs.id}" type=inline_list but payload empty, skipped`);
        continue;
      }
      if (rs.surge_format === "inline_ruleset") {
        // [Ruleset id] 段引用,在文件后面追加该段的内容
        inlineRulesets.push({ name: rs.id, payload: rs.payload });
        const parts = [`RULE-SET,${rs.id}`, policy, ...extraParams, ...flags];
        lines.push(parts.join(","));
      } else {
        for (const item of rs.payload) {
          const parts = [item, policy, ...extraParams, ...flags];
          lines.push(parts.join(","));
        }
      }
    } else if (rs.type === "geosite") {
      // Surge 没有原生 GEOSITE,按三级回退:
      // 1) 用户在 ruleset 上写了 inline payload → 展开为内联规则(最稳)
      // 2) 用户提供了 url → 当作 DOMAIN-SET 引用(适合 SukkaW 那种 list)
      // 3) 都没有 → warning,跳过
      if (rs.payload && rs.payload.length > 0) {
        for (const item of rs.payload) {
          const parts = [item, policy, ...extraParams, ...flags];
          lines.push(parts.join(","));
        }
      } else if (rs.url) {
        lines.push(`DOMAIN-SET,${rs.url},${policy}${flagSuffix}`);
      } else {
        input.warnings.push(
          `GEOSITE rule "${rs.id}" cannot be emitted in Surge: provide either inline payload or DOMAIN-SET url`,
        );
      }
    } else if (rs.type === "geoip") {
      const country = rs.geoip_country_code ?? rs.id;
      lines.push(`GEOIP,${country},${policy}${flagSuffix}`);
    } else if (rs.type === "surge_internal") {
      // Surge 内置 ruleset(SYSTEM / LAN),共平台特性,直接当成普通 RULE-SET 名引用即可。
      // 不带 url,name 必须是 SYSTEM/LAN 之一(schema 已校验)。
      if (!rs.surge_internal_name) {
        input.warnings.push(`Ruleset "${rs.id}" type=surge_internal but surge_internal_name missing, skipped`);
        continue;
      }
      const parts = [`RULE-SET,${rs.surge_internal_name}`, policy, ...extraParams, ...flags];
      lines.push(parts.join(","));
    }
  }
  // Module-level [Rule] additions (only DIRECT/REJECT allowed in modules)
  for (const m of input.surgeModules) {
    if (m.content_sections.rule) lines.push(...splitNonEmpty(m.content_sections.rule));
  }
  if (input.geoipFallback) {
    lines.push(`GEOIP,CN,${input.geoipFallback.policy},no-resolve`);
  }
  if (input.finalRule) {
    const dnsFailed = input.finalRule.dns_failed ? ",dns-failed" : "";
    lines.push(`FINAL,${input.finalRule.policy}${dnsFailed}`);
  }
  lines.push("");

  // Inline rulesets
  for (const ir of inlineRulesets) {
    lines.push(`[Ruleset ${ir.name}]`);
    for (const p of ir.payload) lines.push(p);
    lines.push("");
  }

  // [WireGuard <ID>] sections
  // 顺序在 [Ruleset] 之后、[URL Rewrite] 之前;Surge 的 INI 段没有强制顺序,
  // 但放在 [MITM] 上面便于配置文件目视分组。
  for (const section of wgSections) {
    for (const line of section) lines.push(line);
    lines.push("");
  }

  // [URL Rewrite]
  if (hasModuleSection(input.surgeModules, "url_rewrite")) {
    lines.push("[URL Rewrite]");
    for (const m of input.surgeModules) {
      if (m.content_sections.url_rewrite) lines.push(...splitNonEmpty(m.content_sections.url_rewrite));
    }
    lines.push("");
  }

  // [Header Rewrite]
  if (hasModuleSection(input.surgeModules, "header_rewrite")) {
    lines.push("[Header Rewrite]");
    for (const m of input.surgeModules) {
      if (m.content_sections.header_rewrite) lines.push(...splitNonEmpty(m.content_sections.header_rewrite));
    }
    lines.push("");
  }

  // [Body Rewrite]
  if (hasModuleSection(input.surgeModules, "body_rewrite")) {
    lines.push("[Body Rewrite]");
    for (const m of input.surgeModules) {
      if (m.content_sections.body_rewrite) lines.push(...splitNonEmpty(m.content_sections.body_rewrite));
    }
    lines.push("");
  }

  // [Script]
  if (hasModuleSection(input.surgeModules, "script")) {
    lines.push("[Script]");
    for (const m of input.surgeModules) {
      if (m.content_sections.script) lines.push(...splitNonEmpty(m.content_sections.script));
    }
    lines.push("");
  }

  // [MITM]
  if (general?.mitm?.enable || hasModuleSection(input.surgeModules, "mitm")) {
    lines.push("[MITM]");
    if (general?.mitm) {
      lines.push(`enable = ${general.mitm.enable}`);
      lines.push(`h2 = ${general.mitm.h2}`);
      if (general.mitm.tcp_connection) lines.push(`tcp-connection = ${general.mitm.tcp_connection}`);
      if (general.mitm.skip_server_cert_verify) lines.push(`skip-server-cert-verify = ${general.mitm.skip_server_cert_verify}`);
      if (general.mitm.hostname && general.mitm.hostname.length > 0) {
        lines.push(`hostname = ${general.mitm.hostname.join(", ")}`);
      }
      if (general.mitm.ca_passphrase) lines.push(`ca-passphrase = ${general.mitm.ca_passphrase}`);
      if (general.mitm.ca_p12) lines.push(`ca-p12 = ${general.mitm.ca_p12}`);
    }
    for (const m of input.surgeModules) {
      if (m.content_sections.mitm) lines.push(...splitNonEmpty(m.content_sections.mitm));
    }
    lines.push("");
  }

  // header 在最后才拼接,确保在 generator 流程中产生的所有 warnings(包括
  // wireguard section 等晚期组件)都能进入 # WARN 注释区域。
  const header: string[] = [];
  if (input.managed_config_url && profile.managed_config_url !== "none") {
    header.push(
      `#!MANAGED-CONFIG ${input.managed_config_url} interval=${profile.managed_config_interval} strict=${profile.managed_config_strict}`,
    );
    header.push("");
  }
  header.push("# Generated by NodeDeck");
  header.push(`# Profile: ${profile.id}`);
  header.push(`# Generated at: ${new Date().toISOString()}`);
  for (const w of input.warnings) header.push(`# WARN: ${w}`);
  header.push("");

  return header.concat(lines).join("\n");
}

function appendGeneralLines(lines: string[], g: GeneralPreset): void {
  const kv: Array<[string, unknown]> = [
    ["http-listen", g.http_listen],
    ["socks5-listen", g.socks5_listen],
    ["read-etc-hosts", g.read_etc_hosts],
    ["wifi-assist", g.wifi_assist],
    ["allow-hotspot-access", g.allow_hotspot_access],
    ["allow-wifi-access", g.allow_wifi_access],
    ["internet-test-url", g.internet_test_url],
    ["proxy-test-url", g.proxy_test_url],
    ["test-timeout", g.test_timeout],
    ["proxy-test-udp", g.proxy_test_udp],
    ["udp-policy-not-supported-behaviour", g.udp_policy_not_supported_behaviour],
    ["geoip-maxmind-url", g.geoip_maxmind_url],
    ["ipv6", g.ipv6],
    ["ipv6-vif", g.ipv6_vif],
    ["allow-lan", g.allow_lan],
    ["loglevel", g.log_level === "info" ? "notify" : g.log_level],
    ["exclude-simple-hostnames", g.exclude_simple_hostnames],
    ["show-error-page-for-reject", g.show_error_page_for_reject],
  ];
  if (g.skip_proxy && g.skip_proxy.length > 0) kv.push(["skip-proxy", g.skip_proxy.join(", ")]);
  if (g.always_real_ip && g.always_real_ip.length > 0) kv.push(["always-real-ip", g.always_real_ip.join(", ")]);
  if (g.dns?.server && g.dns.server.length > 0) kv.push(["dns-server", g.dns.server.join(", ")]);
  if (g.dns?.encrypted_server && g.dns.encrypted_server.length > 0) {
    kv.push(["encrypted-dns-server", g.dns.encrypted_server.join(", ")]);
  }
  if (g.dns?.hijack && g.dns.hijack.length > 0) kv.push(["hijack-dns", g.dns.hijack.join(", ")]);
  if (g.http_api) {
    const cred = g.http_api.user ? `${g.http_api.user}:${g.http_api.password}` : g.http_api.password;
    kv.push(["http-api", `${cred}@${g.http_api.listen}`]);
    kv.push(["http-api-web-dashboard", g.http_api.web_dashboard]);
    kv.push(["http-api-tls", g.http_api.tls]);
  }

  for (const [k, v] of kv) {
    if (v === undefined || v === null) continue;
    if (typeof v === "boolean") {
      lines.push(`${k} = ${v}`);
    } else {
      lines.push(`${k} = ${v}`);
    }
  }
}

function hasModuleSection(modules: SurgeModule[], key: keyof SurgeModule["content_sections"]): boolean {
  return modules.some((m) => Boolean(m.content_sections[key]?.trim()));
}

function splitNonEmpty(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter((l) => l.length > 0);
}

export function buildSurgeProxyLine(node: Node, warnings: string[]): string | null {
  if (node.type === "direct") return null; // handled at top
  const params: string[] = [];

  switch (node.type) {
    case "ss":
      params.push(`encrypt-method=${node.cipher ?? "aes-128-gcm"}`);
      if (node.password !== undefined) params.push(`password=${escapeValue(node.password)}`);
      if (node.obfs) params.push(`obfs=${node.obfs}`);
      if (node.obfs_host) params.push(`obfs-host=${node.obfs_host}`);
      if (node.obfs_uri) params.push(`obfs-uri=${node.obfs_uri}`);
      break;
    case "ssr":
      warnings.push(`Skipped SSR node "${node.name}" in Surge output (Surge dropped SSR)`);
      return null;
    case "vmess":
      if (!node.uuid) return null;
      params.push(`username=${node.uuid}`);
      if (node.cipher) params.push(`encrypt-method=${node.cipher}`);
      if (node.vmess_aead !== undefined) params.push(`vmess-aead=${node.vmess_aead}`);
      pushTransport(params, node);
      break;
    case "vless":
      if (!node.uuid) return null;
      params.push(`username=${node.uuid}`);
      if (node.encryption) params.push(`encryption=${node.encryption}`);
      if (node.flow) params.push(`vless-flow=${node.flow}`);
      if (node.reality_opts) {
        params.push(`reality-public-key=${node.reality_opts.public_key}`);
        if (node.reality_opts.short_id) params.push(`reality-short-id=${node.reality_opts.short_id}`);
      }
      pushTransport(params, node);
      break;
    case "trojan":
      if (node.password !== undefined) params.push(`password=${escapeValue(node.password)}`);
      pushTransport(params, node);
      break;
    case "hysteria2":
      if (node.password !== undefined) params.push(`password=${escapeValue(node.password)}`);
      // Surge 5 hysteria2 仅支持 download-bandwidth(单位 Mbps,纯数字),不支持 upload-bandwidth。
      // 参考: https://manual.nssurge.com/policy/proxy.html#parameter-for-hysteria-2
      // up 字段在转 Surge 时静默丢弃(mihomo 端仍会用),不发 warning 避免日志噪音。
      if (node.down) params.push(`download-bandwidth=${stripBandwidthUnit(node.down)}`);
      if (node.obfs) params.push(`obfs=${node.obfs}`);
      if (node.obfs_password) params.push(`obfs-password=${escapeValue(node.obfs_password)}`);
      if (node.port_hopping) params.push(`port-hopping=${node.port_hopping}`);
      if (node.hop_interval !== undefined) params.push(`port-hopping-interval=${node.hop_interval}`);
      break;
    case "tuic":
      // Surge 5 TUIC v5 与 mihomo 一样用 uuid + password,version=5 必须显式标注以区分 v4(token-only)。
      // 参考: https://surge.tel/20/2559 与 manual.nssurge.com/policy/proxy.html
      // mihomo TUIC v4 (用 token 字段) 当前不在 schema 里,生成时统一按 v5 输出。
      if (node.uuid) params.push(`uuid=${node.uuid}`);
      if (node.password !== undefined) params.push(`password=${escapeValue(node.password)}`);
      params.push(`version=${node.tuic_version ?? 5}`);
      break;
    case "wireguard":
      // Surge 5 的 wireguard 采用 section-name 模式:[Proxy] 行只引用一个 ID,密钥/IP/peer
      // 全部写在单独的 [WireGuard <ID>] 段。这里返回 sentinel,主流程会在生成 [Proxy] 行
      // 时直接构造 `<name> = wireguard, section-name=<id>`,并把 [WireGuard <id>] 段追加到输出末尾。
      // 参考: https://manual.nssurge.com/policy/wireguard.html
      return null;
    case "snell":
      if (node.psk) params.push(`psk=${node.psk}`);
      params.push(`version=${node.snell_version ?? 4}`);
      if (node.obfs) params.push(`obfs=${node.obfs}`);
      if (node.obfs_host) params.push(`obfs-host=${node.obfs_host}`);
      break;
    case "anytls":
      if (node.password !== undefined) params.push(`password=${escapeValue(node.password)}`);
      break;
    case "socks5":
      if (node.username) params.push(`username=${node.username}`);
      if (node.password !== undefined) params.push(`password=${escapeValue(node.password)}`);
      break;
    case "http":
    case "https":
      // username/password go positionally in head; see below
      break;
    default:
      warnings.push(`Skipped unsupported node type "${node.type}" in surge output ("${node.name}")`);
      return null;
  }

  if (node.sni) params.push(`sni=${node.sni}`);
  if (node.skip_cert_verify) params.push(`skip-cert-verify=${node.skip_cert_verify}`);
  if (node.client_fingerprint) params.push(`tls-fingerprint=${node.client_fingerprint}`);
  if (node.alpn && node.alpn.length > 0) for (const a of node.alpn) params.push(`alpn=${a}`);
  if (node.tfo) params.push(`tfo=${node.tfo}`);
  if (node.udp !== undefined) params.push(`udp-relay=${node.udp}`);
  if (node.chain_via) params.push(`underlying-proxy=${node.chain_via}`);

  let head = `${node.type}, ${node.server}, ${node.port}`;
  if (node.type === "http" || node.type === "https") {
    // Surge http/https 凭据格式: 必须 username 与 password 同时存在用位置参数;
    // 任一缺失 Surge 5 会拒绝解析,这里直接降级为无认证 + warning。
    if (node.username && node.password !== undefined) {
      head += `, ${node.username}, ${escapeValue(node.password)}`;
    } else if (node.username || node.password !== undefined) {
      warnings.push(
        `${node.type} proxy "${node.name}" requires both username and password; credentials skipped`,
      );
    }
  }

  return `${node.name} = ${head}${params.length > 0 ? ", " + params.join(", ") : ""}`;
}

/**
 * Surge [WireGuard <ID>] 段名要符合 INI section 名规范:ASCII 字母数字 + - _。
 * 节点名常含 emoji / 中文 / 空格,先剥离非法字符,空了就用 idx fallback。
 */
function sanitizeWireGuardSectionId(name: string, idx: number): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9_-]/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return cleaned.length > 0 ? cleaned : `wg-${idx}`;
}

/**
 * 构造 [WireGuard <id>] 段的全部行(不含尾部空行,主流程负责追加)。
 *
 * mihomo 端的 wireguard 既可以把 server/port/public_key 直接写在节点根,也可以用 peers[] 数组承载多 peer。
 * Surge 端 [WireGuard <id>] 段允许多个 `peer = (...)` 并列。这里:
 * - 没有 peers[] 时,从节点根字段合成单 peer(allowed-ips 默认全开)
 * - 有 peers[] 时,逐 peer 输出
 *
 * 不支持的字段会发 warning(reserved 在 Surge 写法是 `client-id = a/b/c` 三字节十进制;
 * mihomo 的 base64 reserved 不做自动转换,避免猜错)。
 */
function buildSurgeWireGuardSection(
  sectionId: string,
  node: Node,
  warnings: string[],
): string[] {
  const out: string[] = [`[WireGuard ${sectionId}]`];
  if (node.private_key) out.push(`private-key = ${node.private_key}`);
  if (node.ip) out.push(`self-ip = ${node.ip}`);
  if (node.ipv6) out.push(`self-ip-v6 = ${node.ipv6}`);
  if (node.mtu !== undefined) out.push(`mtu = ${node.mtu}`);

  if (node.peers && node.peers.length > 0) {
    for (const peer of node.peers) {
      const args: string[] = [];
      args.push(`public-key = ${peer.public_key}`);
      if (peer.preshared_key) args.push(`preshared-key = ${peer.preshared_key}`);
      args.push(`allowed-ips = "${peer.allowed_ips.join(", ")}"`);
      args.push(`endpoint = ${peer.server}:${peer.port}`);
      if (peer.reserved) {
        warnings.push(
          `Surge wireguard "${node.name}" peer.reserved="${peer.reserved}" 未自动转换为 client-id(需手动转 base64→三字节十进制)`,
        );
      }
      out.push(`peer = (${args.join(", ")})`);
    }
  } else {
    const args: string[] = [];
    args.push(`public-key = ${node.public_key ?? ""}`);
    if (node.preshared_key) args.push(`preshared-key = ${node.preshared_key}`);
    args.push(`allowed-ips = "0.0.0.0/0, ::/0"`);
    args.push(`endpoint = ${node.server}:${node.port}`);
    if (node.reserved) {
      warnings.push(
        `Surge wireguard "${node.name}" reserved="${node.reserved}" 未自动转换为 client-id(需手动转 base64→三字节十进制)`,
      );
    }
    out.push(`peer = (${args.join(", ")})`);
  }
  return out;
}

function pushTransport(params: string[], node: Node): void {
  if (node.network === "ws" && node.ws_opts) {
    params.push("ws=true");
    if (node.ws_opts.path) params.push(`ws-path=${node.ws_opts.path}`);
    if (node.ws_opts.headers && Object.keys(node.ws_opts.headers).length > 0) {
      const headerStr = Object.entries(node.ws_opts.headers)
        .map(([k, v]) => `${k}:${v}`)
        .join("|");
      params.push(`ws-headers=${headerStr}`);
    }
  }
}

function stripBandwidthUnit(s: string): string {
  // Surge expects just the number (Mbps assumed). e.g. "200 Mbps" → "200"
  const m = s.trim().match(/^(\d+)/);
  return m ? m[1] : s;
}

function escapeValue(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '\\"')}"`;
  }
  return v;
}

function buildSurgeProxyGroup(g: ProxyGroup, allNodes: Node[]): string {
  const members = resolveSurgeGroupMembers(g, allNodes);
  const params: string[] = [];
  if (g.url) params.push(`url=${g.url}`);
  if (g.interval !== undefined) params.push(`interval=${g.interval}`);
  if (g.tolerance !== undefined) params.push(`tolerance=${g.tolerance}`);
  if (g.timeout !== undefined) params.push(`timeout=${g.timeout}`);
  if (g.evaluate_before_use !== undefined) params.push(`evaluate-before-use=${g.evaluate_before_use}`);
  if (g.persistent !== undefined) params.push(`persistent=${g.persistent}`);
  if (g.hidden !== undefined) params.push(`hidden=${g.hidden}`);
  if (g.policy_path) params.push(`policy-path=${g.policy_path}`);
  if (g.no_alert !== undefined) params.push(`no-alert=${g.no_alert}`);
  if (g.policy_regex_filter) params.push(`policy-regex-filter=${g.policy_regex_filter}`);
  if (g.include_other_group) params.push(`include-other-group="${g.include_other_group}"`);
  if (g.include_all_proxies !== undefined) params.push(`include-all-proxies=${g.include_all_proxies}`);

  const type = g.type === "smart" ? "smart" : g.type;
  const memberStr = members.join(",");
  const paramStr = params.length > 0 ? "," + params.join(",") : "";
  return `${g.name} = ${type},${memberStr}${paramStr}`;
}

function resolveSurgeGroupMembers(g: ProxyGroup, allNodes: Node[]): string[] {
  const members = new Set<string>(g.proxies);
  if (g.selector) {
    // selector.include_other_group(数组形式)直接展开为成员引用,
    // 与顶层 g.include_other_group(Surge 原生展平参数)互补——后者保留为 params。
    if (g.selector.include_other_group && g.selector.include_other_group.length > 0) {
      for (const otherGroup of g.selector.include_other_group) members.add(otherGroup);
    }
    let pool = allNodes.slice();
    if (g.selector.from_providers && g.selector.from_providers.length > 0) {
      pool = pool.filter((n) => n.source_provider_id && g.selector!.from_providers.includes(n.source_provider_id));
    }
    if (g.selector.exclude_type && g.selector.exclude_type.length > 0) {
      pool = pool.filter((n) => !g.selector!.exclude_type.includes(n.type));
    }
    if (g.selector.include_regex) {
      try {
        const re = new RegExp(g.selector.include_regex);
        pool = pool.filter((n) => re.test(n.name));
      } catch {
        // ignore
      }
    }
    if (g.selector.exclude_regex) {
      try {
        const re = new RegExp(g.selector.exclude_regex);
        pool = pool.filter((n) => !re.test(n.name));
      } catch {
        // ignore
      }
    }
    for (const n of pool) members.add(n.name);
  }
  if (members.size === 0) members.add("DIRECT");
  return Array.from(members);
}
