import yaml from "js-yaml";
import type { Node } from "../schemas/node.js";
import type { Profile } from "../schemas/profile.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import type { Provider } from "../schemas/provider.js";
import { applyNodeFilter } from "./node-filter.js";
import { sortNodesByRegion } from "./node-sort.js";
import { applyChainRules, validateChain } from "../chain/apply.js";
import { uniquifyNodeNames, buildProviderLabels } from "./node-naming.js";
import { validateGroupRefs } from "./group-refs.js";
import { buildGroupMemberIndex, filterNodesBySelector } from "./group-members.js";
import { resolveHiddenNodeNames } from "./hidden-nodes.js";
import { logger } from "../logger.js";
import { REJECT_TYPE_MAP } from "./protocol-mapping.js";
import { splitClashHosts } from "./hosts.js";
import { refreshIntervalToSeconds } from "../schemas/common.js";

function downgradeClashPolicy(policy: string): string {
  const mapped = REJECT_TYPE_MAP[policy as keyof typeof REJECT_TYPE_MAP];
  return mapped ? mapped.clash : policy;
}

// Surge manual: https://manual.nssurge.com/rule/ruleset.html#lan
// LAN 内置 ruleset 在 Clash 端展开为等价的内联规则。
// 内容与 Surge 文档列出的一致(包含 LAN IP 范围 + .local 后缀)。
const SURGE_INTERNAL_LAN_RULES: readonly string[] = [
  "DOMAIN-SUFFIX,local",
  "IP-CIDR,192.168.0.0/16",
  "IP-CIDR,10.0.0.0/8",
  "IP-CIDR,172.16.0.0/12",
  "IP-CIDR,127.0.0.0/8",
  "IP-CIDR,100.64.0.0/10",
  "IP-CIDR6,fe80::/10",
];

export interface ClashGenerateInput {
  profile: Profile;
  nodes: Node[];
  groups: ProxyGroup[];
  rules: { ref: string; policy: string; ruleset: RuleSet }[];
  finalRule?: { policy: string; dns_failed?: boolean };
  geoipFallback?: { policy: string };
  general?: GeneralPreset;
  // general.hosts + provider.hosts 合并后的结果(由 profile-resolver 计算)。
  hosts?: Record<string, string | string[]>;
  warnings: string[];
  // providers 元数据,两个用途:
  // 1. 同名节点改名时计算来源前缀 `【标识】`(见 node-naming.ts buildProviderLabels)
  // 2. proxy-providers 模式合成 mihomo 拉取 URL(配合 baseUrl + profileToken,
  //    仅在 profile.clash_options.use_proxy_providers === true 时生效)
  providers?: Provider[];
  baseUrl?: string;
  profileToken?: string;
  // 系统中所有 group 的 name 集合,仅供 validateGroupRefs 做"组未引入"诊断;
  // 不传则退化为旧行为(所有未知引用都归入 nodeDangling)。
  allKnownGroupNames?: Set<string>;
}

export function generateClashConfig(input: ClashGenerateInput): string {
  const { profile, general } = input;
  const filteredRaw = applyNodeFilter(input.nodes, profile.node_filter);
  // 排在 uniquify 之前:组 selector 动态追加成员时遍历的就是已排序节点池,组成员自动跟着聚类
  const filtered = profile.node_filter.sort_by_region ? sortNodesByRegion(filteredRaw) : filteredRaw;
  const uniqued = uniquifyNodeNames(filtered, input.warnings, {
    providerLabels: buildProviderLabels(input.providers ?? []),
    groups: input.groups,
  });
  // hidden_nodes 在改名之后算:用户点名的节点名与最终产物里的一致。
  // 这些节点照常进 proxies(chain_via 指得到),只是不参与组 selector 的动态匹配。
  const hiddenNodes = resolveHiddenNodeNames(uniqued.nodes, profile.hidden_nodes);
  // chain_rules 的 selector.include_groups 需要"组 → 成员节点名"索引。
  // 用改名后的节点/组算(uniqued),这样规则里写的组名与最终产物一致。
  const chained = applyChainRules(uniqued.nodes, profile, {
    groupMembers: buildGroupMemberIndex(uniqued.groups, uniqued.nodes, { hiddenNodes }),
  });
  const groupNames = new Set(uniqued.groups.map((g) => g.name));
  const filteredNodes = validateChain(chained, { groupNames, warnings: input.warnings });
  const sanitizedGroups = validateGroupRefs(uniqued.groups, filteredNodes, {
    warnings: input.warnings,
    allKnownGroupNames: input.allKnownGroupNames,
  });

  // Mihomo proxy-providers 模式:把启用了 clash_proxy_provider 的机场节点剥离出主订阅,
  // 让客户端自己去拉取 /sub/provider/:id/clash.yaml,主订阅中只保留手动节点 + 不属于
  // 这些机场的节点。proxy-providers 段在生成器中按 provider 元数据合成。
  const useProxyProviders = profile.clash_options.use_proxy_providers
    && (input.providers ?? []).some((p) => p.clash_proxy_provider.enabled)
    && Boolean(input.baseUrl)
    && Boolean(input.profileToken);
  const eligibleProviders = useProxyProviders
    ? (input.providers ?? []).filter((p) => p.clash_proxy_provider.enabled)
    : [];
  const eligibleProviderIds = new Set(eligibleProviders.map((p) => p.id));

  const inlineNodes = useProxyProviders
    ? filteredNodes.filter((n) => !n.source_provider_id || !eligibleProviderIds.has(n.source_provider_id))
    : filteredNodes;

  // proxy-providers 模式下,组是通过 `use: [provider_id]` 引用整个机场的,
  // 客户端自己展开成员 → 我们在本地剔除的隐藏节点会被重新捞回选择列表。
  if (hiddenNodes.size > 0 && eligibleProviderIds.size > 0) {
    const leaked = filteredNodes.filter(
      (n) => hiddenNodes.has(n.name) && n.source_provider_id && eligibleProviderIds.has(n.source_provider_id),
    );
    if (leaked.length > 0) {
      input.warnings.push(
        `use_proxy_providers 已开启,${leaked.length} 个隐藏节点来自 proxy-provider 机场,组靠 use: 引用整个机场,这些节点在客户端仍可被直接选择`,
      );
    }
  }

  const proxies = inlineNodes.map((n) => buildClashProxy(n, input.warnings)).filter((p): p is Record<string, unknown> => p !== null);
  const proxyGroups = sanitizedGroups.map((g) => buildClashProxyGroup(g, filteredNodes, eligibleProviderIds, hiddenNodes));
  const ruleProviders: Record<string, unknown> = {};

  const proxyProviders: Record<string, unknown> = {};
  if (useProxyProviders) {
    for (const p of eligibleProviders) {
      proxyProviders[p.id] = buildProxyProviderEntry(p, input.baseUrl!, input.profileToken!, profile.id);
    }
  }

  const rules: string[] = [];
  for (const r of input.rules) {
    const rs = r.ruleset;
    // surge_reject_options.type(如 REJECT-DROP)在 Surge 端会覆盖 r.policy;
    // Clash 不识别 Surge 子类型,这里统一降级到合法 REJECT。
    const rawPolicy = rs.surge_reject_options?.type ?? r.policy;
    const policy = downgradeClashPolicy(rawPolicy);
    const noResolve = rs.surge_flags?.no_resolve ? ",no-resolve" : "";

    // 分发顺序:按 rs.type 优先,clash_format 仅在同 type 内部决定细节(如 remote_url 的输出方式)。
    if (rs.type === "remote_url") {
      if (!rs.url) {
        input.warnings.push(`Ruleset "${rs.id}" type=remote_url but url missing, skipped`);
        continue;
      }
      if (rs.clash_format === "rule_provider") {
        ruleProviders[rs.id] = {
          type: "http",
          behavior: rs.behavior,
          url: rs.url,
          path: `./ruleset/${rs.id}.yaml`,
          interval: rs.update_interval,
          format: rs.format,
        };
        rules.push(`RULE-SET,${rs.id},${policy}${noResolve}`);
      } else {
        // clash_format === "inline":Clash 没有 inline-from-url 能力,继续走 RULE-SET 并 warning
        input.warnings.push(
          `Ruleset "${rs.id}" clash_format=inline + remote_url 不被支持,自动降级为 rule-provider`,
        );
        ruleProviders[rs.id] = {
          type: "http",
          behavior: rs.behavior,
          url: rs.url,
          path: `./ruleset/${rs.id}.yaml`,
          interval: rs.update_interval,
          format: rs.format,
        };
        rules.push(`RULE-SET,${rs.id},${policy}${noResolve}`);
      }
    } else if (rs.type === "inline_list") {
      if (!rs.payload || rs.payload.length === 0) {
        input.warnings.push(`Ruleset "${rs.id}" type=inline_list but payload empty, skipped`);
        continue;
      }
      for (const item of rs.payload) {
        rules.push(`${item},${policy}`);
      }
    } else if (rs.type === "geosite") {
      const category = rs.geosite_category ?? rs.id;
      rules.push(`GEOSITE,${category},${policy}`);
    } else if (rs.type === "geoip") {
      const country = rs.geoip_country_code ?? rs.id;
      rules.push(`GEOIP,${country},${policy}${noResolve}`);
    } else if (rs.type === "surge_internal") {
      // Surge 内置 ruleset 在 Clash 端没有等价语义:
      // - LAN 全是 Clash 也支持的 DOMAIN-SUFFIX/IP-CIDR → 内联展开,功能等价
      // - SYSTEM 含 USER-AGENT 等 Clash 不支持的规则 → 跳过 + warning,避免半残转换
      if (rs.surge_internal_name === "LAN") {
        for (const item of SURGE_INTERNAL_LAN_RULES) {
          rules.push(`${item},${policy}`);
        }
      } else if (rs.surge_internal_name === "SYSTEM") {
        input.warnings.push(
          `Surge 内置 ruleset SYSTEM("${rs.id}") 含 USER-AGENT/PROCESS-NAME 规则,Clash 无等价物,已跳过`,
        );
      } else {
        input.warnings.push(`Ruleset "${rs.id}" type=surge_internal but surge_internal_name missing, skipped`);
      }
    }
  }
  if (input.geoipFallback) {
    rules.push(`GEOIP,CN,${downgradeClashPolicy(input.geoipFallback.policy)},no-resolve`);
  }
  if (input.finalRule) {
    rules.push(`MATCH,${downgradeClashPolicy(input.finalRule.policy)}`);
  }

  const out: Record<string, unknown> = {};

  if (general) {
    if (general.mixed_port !== undefined) out["mixed-port"] = general.mixed_port;
    if (general.port !== undefined) out.port = general.port;
    if (general.socks_port !== undefined) out["socks-port"] = general.socks_port;
    out["allow-lan"] = general.allow_lan;
    out.mode = general.mode;
    out["log-level"] = general.log_level === "notify" ? "info" : general.log_level === "verbose" ? "debug" : general.log_level;
    out.ipv6 = general.ipv6;
    if (general.find_process_mode) out["find-process-mode"] = general.find_process_mode;
    if (general.external_controller) out["external-controller"] = general.external_controller;
    if (general.secret) out.secret = general.secret;
    if (general.global_client_fingerprint) out["global-client-fingerprint"] = general.global_client_fingerprint;
    if (general.geodata_mode !== undefined) out["geodata-mode"] = general.geodata_mode;

    if (general.dns) {
      const dns: Record<string, unknown> = { enable: general.dns.enable };
      if (general.dns.listen) dns.listen = general.dns.listen;
      if (general.dns.ipv6 !== undefined) dns.ipv6 = general.dns.ipv6;
      if (general.dns.enhanced_mode) dns["enhanced-mode"] = general.dns.enhanced_mode;
      if (general.dns.fake_ip_range) dns["fake-ip-range"] = general.dns.fake_ip_range;
      if (general.dns.fake_ip_filter) dns["fake-ip-filter"] = general.dns.fake_ip_filter;
      const ns = general.dns.nameserver?.length ? general.dns.nameserver : general.dns.server;
      if (ns?.length) dns.nameserver = ns;
      if (general.dns.fallback?.length) dns.fallback = general.dns.fallback;
      if (general.dns.nameserver_policy) dns["nameserver-policy"] = general.dns.nameserver_policy;
      if (general.dns.proxy_server_nameserver?.length)
        dns["proxy-server-nameserver"] = general.dns.proxy_server_nameserver;
      out.dns = dns;
    }

    if (general.tun?.enable) {
      out.tun = {
        enable: true,
        stack: general.tun.stack,
        "auto-route": general.tun.auto_route,
        "auto-detect-interface": general.tun.auto_detect_interface,
        "dns-hijack": general.tun.dns_hijack,
        ...(general.tun.mtu !== undefined ? { mtu: general.tun.mtu } : {}),
      };
    }

    if (general.sniffer?.enable) {
      out.sniffer = {
        enable: true,
        ...(general.sniffer.sniff ? { sniff: general.sniffer.sniff } : {}),
      };
    }

  }

  // hosts 来自 general.hosts + provider.hosts 合并;放在 general 块外,
  // 因为即使 profile 没配 general_preset,provider host 仍要带出。
  // server: 条目(指定 DNS 解析器)不进顶层 hosts:,而是投到 dns.proxy-server-nameserver-policy
  // (按域名匹配,多机场不串台);其生效依赖 proxy-server-nameserver 非空。
  if (input.hosts && Object.keys(input.hosts).length > 0) {
    const { staticHosts, serverPolicy } = splitClashHosts(input.hosts, input.warnings);
    if (Object.keys(staticHosts).length > 0) out.hosts = staticHosts;
    if (Object.keys(serverPolicy).length > 0) {
      const dns = (out.dns as Record<string, unknown> | undefined) ?? { enable: true };
      dns["proxy-server-nameserver-policy"] = serverPolicy;
      if (!dns["proxy-server-nameserver"]) {
        input.warnings.push(
          `generals DNS 的 proxy-server-nameserver 为空,${Object.keys(serverPolicy).length} 条 server: host 的 Clash 解析策略(proxy-server-nameserver-policy)不会生效;请在 generals 的 DNS 配置里填写 proxy-server-nameserver`,
        );
      }
      out.dns = dns;
    }
  }

  if (Object.keys(proxyProviders).length > 0) out["proxy-providers"] = proxyProviders;
  out.proxies = proxies;
  out["proxy-groups"] = proxyGroups;
  if (Object.keys(ruleProviders).length > 0) out["rule-providers"] = ruleProviders;
  out.rules = rules;

  logger.debug({ inlineNodes: inlineNodes.length, useProxyProviders }, "clash output composed");

  // flag 影响客户端识别(mihomo / stash 都用 mihomo schema,但 stash 在头注释里期待 # !flag: stash);
  // group_style:block(每键独立成行) vs flow(嵌套用紧凑 inline 写法,主订阅文件更小)。
  const flagLine = profile.clash_options.flag === "stash" ? "# !flag: stash" : "# !flag: mihomo";
  const header = [
    "# Generated by NodeDeck",
    flagLine,
    `# Profile: ${profile.id}`,
    `# Generated at: ${new Date().toISOString()}`,
    ...input.warnings.map((w) => `# WARN: ${w}`),
    "",
  ].join("\n");

  const flowLevel = profile.clash_options.group_style === "flow" ? 2 : -1;
  return header + yaml.dump(out, {
    noRefs: true,
    lineWidth: 200,
    sortKeys: false,
    flowLevel,
  });
}

/**
 * 输出 mihomo proxy-provider 拉取目标的 yaml(仅 proxies: 段),
 * 单独给 /sub/provider/:id/clash.yaml 路由使用。
 */
export function generateProxyProviderYaml(nodes: Node[], warnings: string[]): string {
  // 单 provider 范围内来源前缀无区分意义,不传 providerLabels,同名时走 ` #2` 后缀兜底。
  const uniqued = uniquifyNodeNames(nodes, warnings);
  const proxies = uniqued.nodes
    .map((n) => buildClashProxy(n, warnings))
    .filter((p): p is Record<string, unknown> => p !== null);
  const header = [
    "# Generated by NodeDeck (proxy-provider)",
    `# Generated at: ${new Date().toISOString()}`,
    ...warnings.map((w) => `# WARN: ${w}`),
    "",
  ].join("\n");
  return header + yaml.dump({ proxies }, { noRefs: true, lineWidth: 200, sortKeys: false });
}

function buildProxyProviderEntry(
  provider: Provider,
  baseUrl: string,
  token: string,
  profileId: string,
): Record<string, unknown> {
  return {
    type: "http",
    url: `${baseUrl.replace(/\/$/, "")}/sub/provider/${provider.id}/clash.yaml?profile=${encodeURIComponent(profileId)}&t=${encodeURIComponent(token)}`,
    interval: refreshIntervalToSeconds(provider.refresh.interval),
    path: `./providers/${provider.id}.yaml`,
    "health-check": {
      enable: true,
      url: provider.clash_proxy_provider.health_check_url,
      interval: provider.clash_proxy_provider.health_check_interval,
    },
  };
}

export function buildClashProxy(node: Node, warnings: string[]): Record<string, unknown> | null {
  if (node.type === "snell") {
    warnings.push(`Skipped snell node "${node.name}" in clash output (use surge target instead)`);
    return null;
  }
  if (node.type === "direct") {
    return null; // direct is a builtin
  }

  const out: Record<string, unknown> = {
    name: node.name,
    type: node.type,
    server: node.server,
    port: node.port,
  };

  // common
  if (node.udp !== undefined) out.udp = node.udp;
  if (node.tfo !== undefined) out.tfo = node.tfo;
  // mihomo 通用字段,仅 TCP 协议生效(wiki.metacubex.one/config/proxies/ mptcp 小节)
  if (node.mptcp !== undefined) out.mptcp = node.mptcp;
  if (node.tls !== undefined) out.tls = node.tls;
  if (node.sni !== undefined) out.sni = node.sni;
  if (node.skip_cert_verify !== undefined) out["skip-cert-verify"] = node.skip_cert_verify;
  if (node.fingerprint !== undefined) out.fingerprint = node.fingerprint;
  if (node.client_fingerprint !== undefined) out["client-fingerprint"] = node.client_fingerprint;
  if (node.alpn) out.alpn = node.alpn;

  // Shadow TLS 混淆:mihomo 仅在 shadowsocks 上支持(plugin: shadow-tls),
  // 其余协议(trojan/vmess 等)无对应写法 → 丢弃字段 + warning(snell 在上面已整节点跳过)。
  // ss 的重建放在 switch 内部(与 plugin/plugin-opts 互斥处理)。
  if (node.shadow_tls_password && node.type !== "ss") {
    warnings.push(
      `Clash(mihomo) 仅支持 shadowsocks 的 shadow-tls 混淆,"${node.name}"(${node.type}) 的 shadow-tls 参数已丢弃`,
    );
  }

  switch (node.type) {
    case "ss":
      if (node.cipher) out.cipher = node.cipher;
      if (node.password !== undefined) out.password = node.password;
      if (node.shadow_tls_password) {
        // 解析时已把 plugin: shadow-tls 归一化到 shadow_tls_* 字段,这里对称重建。
        // 若节点同时带了其它 plugin(理论上互斥),shadow-tls 优先并 warning。
        if (node.plugin && node.plugin !== "shadow-tls") {
          warnings.push(
            `ss "${node.name}" 同时配置了 plugin=${node.plugin} 与 shadow-tls,已按 shadow-tls 输出`,
          );
        }
        out.plugin = "shadow-tls";
        out["plugin-opts"] = {
          password: node.shadow_tls_password,
          ...(node.shadow_tls_sni ? { host: node.shadow_tls_sni } : {}),
          ...(node.shadow_tls_version !== undefined ? { version: node.shadow_tls_version } : {}),
        };
      } else {
        if (node.plugin) out.plugin = node.plugin;
        if (node.plugin_opts) out["plugin-opts"] = node.plugin_opts;
      }
      break;
    case "ssr":
      if (node.cipher) out.cipher = node.cipher;
      if (node.password !== undefined) out.password = node.password;
      break;
    case "vmess":
      if (node.uuid) out.uuid = node.uuid;
      out.alterId = node.alter_id ?? 0;
      if (node.cipher) out.cipher = node.cipher;
      writeTransport(out, node);
      break;
    case "vless":
      if (node.uuid) out.uuid = node.uuid;
      if (node.flow) out.flow = node.flow;
      if (node.encryption) out.encryption = node.encryption;
      if (node.reality_opts) {
        out["reality-opts"] = {
          "public-key": node.reality_opts.public_key,
          ...(node.reality_opts.short_id ? { "short-id": node.reality_opts.short_id } : {}),
        };
      }
      writeTransport(out, node);
      break;
    case "trojan":
      if (node.password !== undefined) out.password = node.password;
      writeTransport(out, node);
      break;
    case "hysteria2":
      if (node.password !== undefined) out.password = node.password;
      if (node.up) out.up = node.up;
      if (node.down) out.down = node.down;
      if (node.obfs) out.obfs = node.obfs;
      if (node.obfs_password) out["obfs-password"] = node.obfs_password;
      if (node.port_hopping) out.ports = node.port_hopping;
      if (node.hop_interval !== undefined) out["hop-interval"] = node.hop_interval;
      break;
    case "tuic":
      if (node.uuid) out.uuid = node.uuid;
      if (node.password !== undefined) out.password = node.password;
      out.version = node.tuic_version ?? 5;
      if (node.congestion_controller) out["congestion-controller"] = node.congestion_controller;
      break;
    case "wireguard":
      if (node.private_key) out["private-key"] = node.private_key;
      if (node.public_key) out["public-key"] = node.public_key;
      if (node.preshared_key) out["preshared-key"] = node.preshared_key;
      if (node.ip) out.ip = node.ip;
      if (node.ipv6) out.ipv6 = node.ipv6;
      if (node.reserved) out.reserved = node.reserved;
      if (node.mtu !== undefined) out.mtu = node.mtu;
      if (node.peers) out.peers = node.peers;
      break;
    case "anytls":
      if (node.password !== undefined) out.password = node.password;
      break;
    case "socks5":
      if (node.username) out.username = node.username;
      if (node.password !== undefined) out.password = node.password;
      break;
    case "http":
      if (node.username) out.username = node.username;
      if (node.password !== undefined) out.password = node.password;
      break;
    default:
      warnings.push(`Skipped unsupported node type "${node.type}" in clash output ("${node.name}")`);
      return null;
  }

  if (node.chain_via) out["dialer-proxy"] = node.chain_via;
  return out;
}

function writeTransport(out: Record<string, unknown>, node: Node): void {
  if (!node.network || node.network === "tcp") return;
  out.network = node.network;
  if (node.network === "ws" && node.ws_opts) {
    const wso: Record<string, unknown> = { path: node.ws_opts.path };
    if (node.ws_opts.headers && Object.keys(node.ws_opts.headers).length > 0) {
      wso.headers = node.ws_opts.headers;
    }
    out["ws-opts"] = wso;
  } else if (node.network === "grpc" && node.grpc_opts) {
    out["grpc-opts"] = { "grpc-service-name": node.grpc_opts.service_name };
  } else if (node.network === "h2" && node.h2_opts) {
    out["h2-opts"] = { path: node.h2_opts.path, host: node.h2_opts.host };
  }
}

function buildClashProxyGroup(
  g: ProxyGroup,
  allNodes: Node[],
  proxyProviderIds: Set<string>,
  hiddenNodes: Set<string>,
): Record<string, unknown> {
  // proxy-providers 模式下:
  // - 来自 eligible providers 的节点不在主订阅 proxies 段,group 通过 use: [provider_id] 引用
  // - g.use 字段(若用户手动指定)优先生效
  const useList = new Set<string>(g.use ?? []);
  if (proxyProviderIds.size > 0) {
    if (g.selector?.from_providers && g.selector.from_providers.length > 0) {
      for (const pid of g.selector.from_providers) {
        if (proxyProviderIds.has(pid)) useList.add(pid);
      }
    } else {
      // 默认把所有启用了 proxy-provider 的机场都加入 use
      for (const pid of proxyProviderIds) useList.add(pid);
    }
  }

  const proxies = resolveGroupMembers(g, allNodes, proxyProviderIds, hiddenNodes);
  const out: Record<string, unknown> = {
    name: g.name,
    type: g.type === "smart" ? "url-test" : g.type === "ssid" ? "select" : g.type,
    proxies,
  };
  if (g.url) out.url = g.url;
  if (g.interval !== undefined) out.interval = g.interval;
  if (g.tolerance !== undefined) out.tolerance = g.tolerance;
  if (g.timeout !== undefined) out.timeout = g.timeout;
  if (g.lazy !== undefined) out.lazy = g.lazy;
  if (g.disable_udp !== undefined) out["disable-udp"] = g.disable_udp;
  if (useList.size > 0) out.use = Array.from(useList);
  return out;
}

function resolveGroupMembers(
  g: ProxyGroup,
  allNodes: Node[],
  proxyProviderIds: Set<string>,
  hiddenNodes: Set<string>,
): string[] {
  const members = new Set<string>(g.proxies);
  // 顶层 include_other_group(Surge 风格的单组引用)在 Clash 端没有原生字段,
  // 这里直接当成"成员组名"展开,与 Surge 把它放进 params 的语义对齐。
  if (g.include_other_group) members.add(g.include_other_group);
  // nested_groups:把其它策略组作为单个 proxy 项嵌套引用加进 yaml proxies 列表。
  // 与 mihomo 原生写法(yaml proxies 数组里直接放组名)一致;客户端点开该项会
  // 跳转到那个组的子选择器。schema transform 已把老的 selector.include_other_group
  // 迁移到这里,不再从 selector 读取。
  // `?? []` 是 defensive — 经 schema parse 的 group 一定有这个字段(default []),
  // 但测试里手动构造的 ProxyGroup literal 可能漏写。
  for (const otherGroup of g.nested_groups ?? []) members.add(otherGroup);
  if (g.selector) {
    // proxy-providers 模式:剥离掉 use 段引用的 provider 节点,避免重复
    const base =
      proxyProviderIds.size > 0
        ? allNodes.filter((n) => !n.source_provider_id || !proxyProviderIds.has(n.source_provider_id))
        : allNodes;
    // 隐藏节点只挡 selector 动态匹配;上面 g.proxies 的显式点名是用户的明确意图,保留。
    const selectable = hiddenNodes.size > 0 ? base.filter((n) => !hiddenNodes.has(n.name)) : base;
    for (const n of filterNodesBySelector(selectable, g.selector)) members.add(n.name);
  }
  // proxy-providers 模式下,group 可以仅靠 use 引用,proxies 列表允许为空(mihomo 接受);
  // 否则保持原行为,空就回退到 DIRECT。
  if (members.size === 0 && proxyProviderIds.size === 0) members.add("DIRECT");
  return Array.from(members);
}
