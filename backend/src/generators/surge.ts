import type { Node } from "../schemas/node.js";
import type { Profile } from "../schemas/profile.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import type { SurgeModule } from "../schemas/surge-module.js";
import type { Provider } from "../schemas/provider.js";
import { applyNodeFilter } from "./node-filter.js";
import { sortNodesByRegion } from "./node-sort.js";
import { applyChainRules, validateChain } from "../chain/apply.js";
import { uniquifyNodeNames, buildProviderLabels, escapeSurgeNames } from "./node-naming.js";
import { validateGroupRefs, GROUP_BUILTIN_POLICIES } from "./group-refs.js";
import { buildGroupMemberIndex, resolveGroupMemberEntries } from "./group-members.js";
import { resolveHiddenNodeNames } from "./hidden-nodes.js";
import { REJECT_TYPE_MAP } from "./protocol-mapping.js";
import { buildSurgeHostLines } from "./hosts.js";

export interface SurgeGenerateInput {
  profile: Profile;
  nodes: Node[];
  groups: ProxyGroup[];
  rules: { ref: string; policy: string; ruleset: RuleSet }[];
  finalRule?: { policy: string; dns_failed?: boolean };
  geoipFallback?: { policy: string };
  general?: GeneralPreset;
  // general.hosts + provider.hosts 合并后的结果(由 profile-resolver 计算)。
  hosts?: Record<string, string | string[]>;
  surgeModules: SurgeModule[];
  managed_config_url?: string;
  // providers 元数据,用于同名节点改名时计算来源前缀 `【标识】`(见 node-naming.ts)。
  providers?: Provider[];
  warnings: string[];
  // 系统中所有 group 的 name 集合,仅供 validateGroupRefs 做"组未引入"诊断;
  // 不传则退化为旧行为(所有未知引用都归入 nodeDangling)。
  allKnownGroupNames?: Set<string>;
}

export function generateSurgeConfig(input: SurgeGenerateInput): string {
  const { profile, general } = input;
  const filteredRaw = applyNodeFilter(input.nodes, profile.node_filter);
  // 排在 uniquify 之前:组 selector 动态追加成员时遍历的就是已排序节点池,组成员自动跟着聚类
  const filtered = profile.node_filter.sort_by_region ? sortNodesByRegion(filteredRaw) : filteredRaw;
  const uniqued = uniquifyNodeNames(filtered, input.warnings, {
    providerLabels: buildProviderLabels(input.providers ?? []),
    groups: input.groups,
  });
  // Surge 专属:把 = , " 等会破坏 INI 行解析的字符替换掉,且同步改写所有引用。
  const escaped = escapeSurgeNames(uniqued.nodes, uniqued.groups, input.warnings);
  // hidden_nodes 在 escape 之后算:用户点名的节点名与最终产物里的一致。
  // 这些节点照常进 [Proxy](underlying-proxy 指得到),只是不参与组 selector 的动态匹配。
  const hiddenNodes = resolveHiddenNodeNames(escaped.nodes, profile.hidden_nodes);
  // chain_rules 的 selector.include_groups 需要"组 → 成员节点名"索引。
  // 用 escape 之后的节点/组算,保证组名与 Surge 产物里的一致。
  const chained = applyChainRules(escaped.nodes, profile, {
    groupMembers: buildGroupMemberIndex(escaped.groups, escaped.nodes, { hiddenNodes }),
  });
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
  if ((input.hosts && Object.keys(input.hosts).length > 0) || hasModuleSection(input.surgeModules, "host")) {
    lines.push("[Host]");
    if (input.hosts) {
      lines.push(...buildSurgeHostLines(input.hosts, input.warnings));
    }
    for (const m of input.surgeModules) {
      if (m.content_sections.host) lines.push(...splitNonEmpty(m.content_sections.host));
    }
    lines.push("");
  }

  // [SSID Setting](官方文档名 Subnet Settings)
  if (general?.ssid_rules && general.ssid_rules.length > 0) {
    const ssidLines = buildSubnetSettingLines(general.ssid_rules, input.warnings);
    if (ssidLines.length > 0) {
      lines.push("[SSID Setting]");
      lines.push(...ssidLines);
      lines.push("");
    }
  }

  // [MTProto] — Surge 作为 Telegram MTProto 入站代理(iOS 5.21.0+ / Mac 6.8.0+)。
  // 一个 profile 仅允许一个该段;secret 必须是 32 位十六进制(可带 dd 前缀),
  // 不合法时跳过整段 + warning(Surge 会拒绝加载非法 secret)。
  if (general?.mtproto?.enable) {
    const mt = general.mtproto;
    if (!/^(dd)?[0-9a-fA-F]{32}$/.test(mt.secret)) {
      input.warnings.push(
        `MTProto secret 不合法(需 32 位十六进制,可带 dd 前缀),[MTProto] 段已跳过`,
      );
    } else {
      lines.push("[MTProto]");
      lines.push(`interface = ${mt.interface}`);
      lines.push(`port = ${mt.port}`);
      lines.push(`secret = ${mt.secret}`);
      if (mt.ipv6 !== undefined) lines.push(`ipv6 = ${mt.ipv6}`);
      if (mt.dc_config_url) lines.push(`dc-config-url = ${mt.dc_config_url}`);
      lines.push("");
    }
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
      // Surge 的 wireguard **支持** underlying-proxy(manual.nssurge.com/policies/wireguard.html:
      // 把加密后的 UDP 数据报经另一策略转发,默认 DIRECT)。之前这里当成不支持直接丢弃是误判。
      // 真正不支持的是 interface 绑定与 shadow-tls-*。
      const wgParams = node.chain_via ? `, underlying-proxy=${node.chain_via}` : "";
      const head = `${node.name} = wireguard, section-name=${sid}${wgParams}`;
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
    const activeGroupNames = new Set(sanitizedGroups.map((g) => g.name));
    for (const g of sanitizedGroups) {
      lines.push(buildSurgeProxyGroup(g, filteredNodes, hiddenNodes, input.warnings, activeGroupNames));
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
    const extraParams: string[] = [];
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
      // Surge 的规则集重下间隔默认 86400,只有非默认值才输出,避免给产物加噪音。
      // 之前从不输出,用户在 UI 里改了间隔在 Surge 侧是无声失效的。
      const updateInterval =
        rs.update_interval !== undefined && rs.update_interval !== 86400
          ? [`update-interval=${rs.update_interval}`]
          : [];
      if (rs.surge_format === "domain_set") {
        const parts = [`DOMAIN-SET,${rs.url}`, policy, ...updateInterval, ...flags];
        lines.push(parts.join(","));
      } else {
        const parts = [`RULE-SET,${rs.url}`, policy, ...extraParams, ...updateInterval, ...flags];
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
    ["block-quic", g.block_quic],
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
    kv.push(["http-api", `${g.http_api.password}@${g.http_api.listen}`]);
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

/**
 * `[SSID Setting]` 段(官方文档名 Subnet Settings)。每行 = 一个 subnet 表达式 + **逗号分隔**的
 * `key=value` 参数(https://manual.nssurge.com/features/subnet-settings.html)。
 *
 * 两个易错点:
 * - 参数之间是逗号,不是空格。`dns-server` / `encrypted-dns-server` 自身的多值也用逗号,
 *   靠"token 里有没有 `=`"区分,所以这两个列表型参数排在最后,避免歧义
 * - 表达式含空格(SSID 带空格)时整个表达式要用双引号包起来,见
 *   https://kb.nssurge.com/surge-knowledge-base/technotes/tfo 的示例
 *
 * 这里**不输出 `policy=`**:按网络选策略是 subnet 组 / `SUBNET` 规则的事,本段没这个参数。
 */
function buildSubnetSettingLines(
  rules: NonNullable<GeneralPreset["ssid_rules"]>,
  warnings: string[],
): string[] {
  const lines: string[] = [];
  rules.forEach((r, i) => {
    const expr = r.match.trim();
    if (expr === "") {
      warnings.push(`[SSID Setting] 第 ${i + 1} 条没填网络匹配表达式(SSID: / TYPE: 等),已跳过`);
      return;
    }
    const params: string[] = [];
    if (r.suspend !== undefined) params.push(`suspend=${r.suspend}`);
    if (r.cellular_fallback) params.push(`cellular-fallback=${r.cellular_fallback}`);
    if (r.cellular_mode !== undefined) params.push(`cellular-mode=${r.cellular_mode}`);
    if (r.tfo_behaviour) params.push(`tfo-behaviour=${r.tfo_behaviour}`);
    if (r.dns_server && r.dns_server.length > 0) params.push(`dns-server=${r.dns_server.join(",")}`);
    if (r.encrypted_dns_server && r.encrypted_dns_server.length > 0) {
      params.push(`encrypted-dns-server=${r.encrypted_dns_server.join(",")}`);
    }
    if (params.length === 0) {
      warnings.push(`[SSID Setting] "${expr}" 没有任何生效参数(suspend / dns-server / ...),已跳过`);
      return;
    }
    lines.push(`${/\s/.test(expr) ? `"${expr}"` : expr} ${params.join(",")}`);
  });
  return lines;
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
      // Surge vmess 默认明文,必须显式 tls=true 才走 TLS(trojan/https 等由类型隐含,无此参数)。
      // 参考 Surge Mac release note 官方示例: vmess, ..., ws=true, tls=true
      if (node.tls) params.push("tls=true");
      pushTransport(params, node);
      break;
    case "vless":
      // Surge 完全没有 vless:manual.nssurge.com/policies/overview.html 的协议表里没有这个
      // 类型关键字,也不存在 vless-flow / reality-* 参数。历史上这里按臆测的键名输出过,
      // 结果是 Surge 加载时解析不了这一行 —— 现在与 ssr 一样整节点跳过。
      warnings.push(
        `Skipped VLESS node "${node.name}" in Surge output (Surge 不支持 vless 协议;如需使用请在本机用 sing-box 等桥成 socks5)`,
      );
      return null;
    case "trojan":
      if (node.password !== undefined) params.push(`password=${escapeValue(node.password)}`);
      pushTransport(params, node);
      break;
    case "hysteria2":
      if (node.password !== undefined) params.push(`password=${escapeValue(node.password)}`);
      // Surge hysteria2 仅支持 download-bandwidth(单位 Mbps,纯数字),不支持 upload-bandwidth。
      // 参考: https://manual.nssurge.com/policy/proxy.html#parameter-for-hysteria-2
      // up 字段在转 Surge 时静默丢弃(mihomo 端仍会用),不发 warning 避免日志噪音。
      if (node.down) params.push(`download-bandwidth=${stripBandwidthUnit(node.down)}`);
      // Surge 端没有 hysteria2 的 obfs=/obfs-password= 键,混淆按类型用单键表达:
      // salamander → salamander-password=(iOS 5.17.0+ / Mac 6.4.3+)
      // gecko → gecko-password=(iOS 5.20.0+ / Mac 6.7.0+)
      // mihomo 的 obfs: + obfs-password: 两键在这里折叠成一键;其他 obfs 类型 Surge 不支持。
      if (node.obfs === "gecko") {
        if (node.obfs_password) {
          params.push(`gecko-password=${escapeValue(node.obfs_password)}`);
        } else {
          warnings.push(
            `Surge hysteria2 "${node.name}" obfs=gecko 但缺 obfs-password,混淆未启用`,
          );
        }
      } else if (node.obfs && node.obfs !== "salamander") {
        warnings.push(
          `Surge hysteria2 "${node.name}" obfs="${node.obfs}" 不被支持(仅 salamander/gecko),混淆参数已跳过`,
        );
      } else if (node.obfs_password) {
        params.push(`salamander-password=${escapeValue(node.obfs_password)}`);
      } else if (node.obfs === "salamander") {
        warnings.push(
          `Surge hysteria2 "${node.name}" obfs=salamander 但缺 obfs-password,混淆未启用`,
        );
      }
      if (node.port_hopping) params.push(`port-hopping=${node.port_hopping}`);
      if (node.hop_interval !== undefined) params.push(`port-hopping-interval=${node.hop_interval}`);
      break;
    case "tuic":
      // Surge TUIC v5 与 mihomo 一样用 uuid + password,version=5 必须显式标注以区分 v4(token-only)。
      // 参考: https://surge.tel/20/2559 与 manual.nssurge.com/policy/proxy.html
      // mihomo TUIC v4 (用 token 字段) 当前不在 schema 里,生成时统一按 v5 输出。
      if (node.uuid) params.push(`uuid=${node.uuid}`);
      if (node.password !== undefined) params.push(`password=${escapeValue(node.password)}`);
      params.push(`version=${node.tuic_version ?? 5}`);
      break;
    case "wireguard":
      // Surge 的 wireguard 采用 section-name 模式:[Proxy] 行只引用一个 ID,密钥/IP/peer
      // 全部写在单独的 [WireGuard <ID>] 段。这里返回 sentinel,主流程会在生成 [Proxy] 行
      // 时直接构造 `<name> = wireguard, section-name=<id>`,并把 [WireGuard <id>] 段追加到输出末尾。
      // 参考: https://manual.nssurge.com/policy/wireguard.html
      return null;
    case "snell":
      if (node.psk) params.push(`psk=${node.psk}`);
      params.push(`version=${node.snell_version ?? 4}`);
      if (node.reuse !== undefined) params.push(`reuse=${node.reuse}`);
      if (node.obfs) params.push(`obfs=${node.obfs}`);
      if (node.obfs_host) params.push(`obfs-host=${node.obfs_host}`);
      // obfs-uri 仅在 obfs=http 下有意义(manual.nssurge.com/policies/snell.html);
      // 之前只有 ss 分支输出了它,snell 这边漏了。
      if (node.obfs_uri && node.obfs === "http") params.push(`obfs-uri=${node.obfs_uri}`);
      break;
    case "anytls":
      if (node.password !== undefined) params.push(`password=${escapeValue(node.password)}`);
      // AnyTLS 规范默认开启连接复用,仅 reuse=false 有显式意义,但 true 也照写(幂等)
      if (node.reuse !== undefined) params.push(`reuse=${node.reuse}`);
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
  // 证书 DNSName 校验目标与 SNI 解耦(iOS 5.21.0+ / Mac 6.8.0+),机场伪装 SNI 时用得上
  if (node.name_cert_verify) params.push(`server-cert-verify-name=${node.name_cert_verify}`);
  if (node.ip_version) params.push(`ip-version=${SURGE_IP_VERSION[node.ip_version]}`);
  // 节点级测速覆盖:Surge 现行版本已废弃组行的 url=,这三个键与 [General] 的全局值
  // 是仅有的入口(解析顺序:节点 test-url → [General] proxy-test-url → 默认)。
  if (node.test_url) params.push(`test-url=${node.test_url}`);
  if (node.test_timeout !== undefined) params.push(`test-timeout=${node.test_timeout}`);
  if (node.test_udp) params.push(`test-udp=${node.test_udp}`);
  if (node.skip_cert_verify) params.push(`skip-cert-verify=${node.skip_cert_verify}`);
  // 服务器证书指纹锁定(TLS 通用参数,适用 HTTP/SOCKS5-TLS/VMess/Trojan/TUIC/Hysteria2/AnyTLS):
  // 用固定证书指纹替代标准 X.509 校验,机场常借此配合伪装 SNI 使用。
  // 区别于下面 client_fingerprint -> tls-fingerprint(uTLS 客户端指纹)。
  if (node.fingerprint) params.push(`server-cert-fingerprint-sha256=${node.fingerprint}`);
  if (node.client_fingerprint) params.push(`tls-fingerprint=${node.client_fingerprint}`);
  if (node.alpn && node.alpn.length > 0) for (const a of node.alpn) params.push(`alpn=${a}`);
  if (node.tfo) params.push(`tfo=${node.tfo}`);
  if (node.udp !== undefined) params.push(`udp-relay=${node.udp}`);
  // Shadow TLS 混淆可叠加在任意 TCP 协议上(v2: Mac 4.10.0+;v3: Mac 5.0.3+)。
  // Surge 只认 version 2/3(缺省 2);v1 无对应写法,跳过 version 键并 warning。
  if (node.shadow_tls_password) {
    params.push(`shadow-tls-password=${escapeValue(node.shadow_tls_password)}`);
    if (node.shadow_tls_sni) params.push(`shadow-tls-sni=${node.shadow_tls_sni}`);
    if (node.shadow_tls_version === 2 || node.shadow_tls_version === 3) {
      params.push(`shadow-tls-version=${node.shadow_tls_version}`);
    } else if (node.shadow_tls_version === 1) {
      warnings.push(
        `Surge 不支持 shadow-tls v1("${node.name}"),已按缺省 v2 输出,若服务端为 v1 将无法握手`,
      );
    }
  }
  if (node.chain_via) params.push(`underlying-proxy=${node.chain_via}`);

  // socks5-tls 在 Surge 是独立的类型关键字,不是 socks5 + 某个参数
  // (manual.nssurge.com/policies/socks5.html);parser 读进来时折叠成了 type=socks5 + tls,
  // 这里必须还原,否则导入再导出会静默退化成明文 socks5。
  const typeKeyword = node.type === "socks5" && node.tls ? "socks5-tls" : node.type;
  let head = `${typeKeyword}, ${node.server}, ${node.port}`;
  if (node.type === "http" || node.type === "https") {
    // Surge http/https 凭据格式: 必须 username 与 password 同时存在用位置参数;
    // 任一缺失 Surge 会拒绝解析,这里直接降级为无认证 + warning。
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
  if (node.mtu !== undefined) {
    // 手册给的有效区间是 576–1420(默认 1280);schema 为兼容存量放宽到 9000,这里提醒。
    if (node.mtu > 1420) {
      warnings.push(
        `Surge wireguard "${node.name}" mtu=${node.mtu} 超出手册范围(576-1420),客户端可能拒绝或截断`,
      );
    }
    out.push(`mtu = ${node.mtu}`);
  }
  // dns-server 决定 Surge 把该策略当「通用代理」还是「点对点」,进而决定默认测速方式
  // (无 dns-server → 原生 RTT 探测;有 → 标准 URL 测速)。WARP 类节点缺了它测速会不符预期。
  if (node.wg_dns_server && node.wg_dns_server.length > 0) {
    out.push(`dns-server = ${node.wg_dns_server.join(", ")}`);
  }
  if (node.wg_prefer_ipv6 !== undefined) out.push(`prefer-ipv6 = ${node.wg_prefer_ipv6}`);

  if (node.peers && node.peers.length > 0) {
    for (const peer of node.peers) {
      const args: string[] = [];
      args.push(`public-key = ${peer.public_key}`);
      if (peer.preshared_key) args.push(`preshared-key = ${peer.preshared_key}`);
      args.push(`allowed-ips = "${peer.allowed_ips.join(", ")}"`);
      args.push(`endpoint = ${peer.server}:${peer.port}`);
      if (peer.keepalive !== undefined) args.push(`keepalive = ${peer.keepalive}`);
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

/** 内部统一用 mihomo 的 ip-version 枚举,Surge 侧键名相同但取值不同。 */
const SURGE_IP_VERSION: Record<NonNullable<Node["ip_version"]>, string> = {
  dual: "dual",
  ipv4: "v4-only",
  ipv6: "v6-only",
  "ipv4-prefer": "prefer-v4",
  "ipv6-prefer": "prefer-v6",
};

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

function buildSurgeProxyGroup(
  g: ProxyGroup,
  allNodes: Node[],
  hiddenNodes: Set<string>,
  warnings: string[],
  knownGroupNames: Set<string>,
): string {
  const members = resolveSurgeGroupMembers(g, allNodes, hiddenNodes);
  // Surge 的 smart 组会**静默忽略**成员里的嵌套组与内置策略
  // (manual.nssurge.com/policy-groups/overview.html 的 Nesting Groups 小节),
  // 客户端不会报错,用户只会发现"配了但没用",所以这里主动提示。
  if (g.type === "smart") {
    const ignored = members.filter((m) => knownGroupNames.has(m) || GROUP_BUILTIN_POLICIES.has(m));
    if (ignored.length > 0) {
      warnings.push(
        `Surge smart 组 "${g.name}" 的成员 [${ignored.join(", ")}] 是嵌套组或内置策略,`
          + `smart 组会静默忽略它们;需要它们参与选择请改用 url-test / fallback / select`,
      );
    }
  }
  const params: string[] = [];
  // g.url 刻意不输出:Surge 现行版本已把组行上的 `url=` 列为 legacy 且完全无效,测速 URL 只认
  // per-policy 的 `test-url` 或 [General] 的 proxy-test-url / internet-test-url。该字段仍保留在
  // schema 里,因为 mihomo 的 url-test / fallback 组需要它(见 clash.ts)。
  // interval 对 Smart 组同样无效(manual.nssurge.com/policy-groups/smart.html),不输出免噪音。
  if (g.interval !== undefined && g.type !== "smart") params.push(`interval=${g.interval}`);
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
  if (g.underlying_proxy) params.push(`underlying-proxy=${g.underlying_proxy}`);
  if (g.icon_url) params.push(`icon-url=${g.icon_url}`);
  // Smart 组唯一的调参手段;值里的 `;` 会被 INI 行解析吃掉,必须整体加引号
  if (g.policy_priority) params.push(`policy-priority="${g.policy_priority}"`);

  const type = g.type === "smart" ? "smart" : g.type;
  const memberStr = members.join(",");
  const paramStr = params.length > 0 ? "," + params.join(",") : "";
  return `${g.name} = ${type},${memberStr}${paramStr}`;
}

function resolveSurgeGroupMembers(g: ProxyGroup, allNodes: Node[], hiddenNodes: Set<string>): string[] {
  // 顶层 g.include_other_group 是 Surge 原生 include-other-group 参数(语义是平铺展开其它组的
  // 成员节点),保留为 params 而不是成员,故 inlineIncludeOtherGroup=false。
  // 注意 include-all-proxies / policy-regex-filter 由 Surge 客户端自己展开 [Proxy] 段,
  // 本地过滤不到 —— 那类组仍会把隐藏节点列出来。
  return resolveGroupMemberEntries(g, allNodes, {
    hiddenNodes,
    inlineIncludeOtherGroup: false,
    emptyFallback: true,
  }).map((m) => m.name);
}
