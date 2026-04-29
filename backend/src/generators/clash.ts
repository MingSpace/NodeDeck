import yaml from "js-yaml";
import type { Node } from "../schemas/node.js";
import type { Profile } from "../schemas/profile.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import { applyNodeFilter } from "./node-filter.js";
import { applyChainRules } from "../chain/apply.js";
import { logger } from "../logger.js";

export interface ClashGenerateInput {
  profile: Profile;
  nodes: Node[];
  groups: ProxyGroup[];
  rules: { ref: string; policy: string; ruleset: RuleSet }[];
  finalRule?: { policy: string; dns_failed?: boolean };
  geoipFallback?: { policy: string };
  general?: GeneralPreset;
  warnings: string[];
}

export function generateClashConfig(input: ClashGenerateInput): string {
  const { profile, general } = input;
  const filteredNodes = applyChainRules(applyNodeFilter(input.nodes, profile.node_filter), profile);

  const proxies = filteredNodes.map((n) => buildClashProxy(n, input.warnings)).filter((p): p is Record<string, unknown> => p !== null);
  const proxyGroups = input.groups.map((g) => buildClashProxyGroup(g, filteredNodes));
  const ruleProviders: Record<string, unknown> = {};
  const inlineRulesSections: { lines: string[]; comment: string }[] = [];

  const rules: string[] = [];
  for (const r of input.rules) {
    const rs = r.ruleset;
    if (rs.clash_format === "rule_provider" && rs.type === "remote_url" && rs.url) {
      ruleProviders[rs.id] = {
        type: "http",
        behavior: rs.behavior,
        url: rs.url,
        path: `./ruleset/${rs.id}.yaml`,
        interval: rs.update_interval,
        format: rs.format,
      };
      const noResolve = rs.surge_flags?.no_resolve ? ",no-resolve" : "";
      rules.push(`RULE-SET,${rs.id},${r.policy}${noResolve}`);
    } else if (rs.type === "geosite") {
      rules.push(`GEOSITE,${rs.url ?? rs.id},${r.policy}`);
    } else if (rs.type === "geoip") {
      const noResolve = rs.surge_flags?.no_resolve ? ",no-resolve" : "";
      rules.push(`GEOIP,${rs.url ?? rs.id},${r.policy}${noResolve}`);
    } else if (rs.payload && rs.payload.length > 0) {
      // inline payload -> emit each line directly into rules with the policy
      for (const item of rs.payload) {
        rules.push(`${item},${r.policy}`);
      }
    }
  }
  if (input.geoipFallback) {
    rules.push(`GEOIP,CN,${input.geoipFallback.policy},no-resolve`);
  }
  if (input.finalRule) {
    rules.push(`MATCH,${input.finalRule.policy}`);
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

    if (general.hosts && Object.keys(general.hosts).length > 0) {
      out.hosts = general.hosts;
    }
  }

  out.proxies = proxies;
  out["proxy-groups"] = proxyGroups;
  if (Object.keys(ruleProviders).length > 0) out["rule-providers"] = ruleProviders;
  out.rules = rules;

  inlineRulesSections.forEach((s) => logger.debug({ s }, "inline ruleset"));

  const header = [
    "# Generated by MConvert",
    `# Profile: ${profile.id}`,
    `# Generated at: ${new Date().toISOString()}`,
    ...input.warnings.map((w) => `# WARN: ${w}`),
    "",
  ].join("\n");

  return header + yaml.dump(out, { noRefs: true, lineWidth: 200, sortKeys: false });
}

function buildClashProxy(node: Node, warnings: string[]): Record<string, unknown> | null {
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
  if (node.tls !== undefined) out.tls = node.tls;
  if (node.sni !== undefined) out.sni = node.sni;
  if (node.skip_cert_verify !== undefined) out["skip-cert-verify"] = node.skip_cert_verify;
  if (node.fingerprint !== undefined) out.fingerprint = node.fingerprint;
  if (node.client_fingerprint !== undefined) out["client-fingerprint"] = node.client_fingerprint;
  if (node.alpn) out.alpn = node.alpn;

  switch (node.type) {
    case "ss":
      if (node.cipher) out.cipher = node.cipher;
      if (node.password !== undefined) out.password = node.password;
      if (node.plugin) out.plugin = node.plugin;
      if (node.plugin_opts) out["plugin-opts"] = node.plugin_opts;
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

function buildClashProxyGroup(g: ProxyGroup, allNodes: Node[]): Record<string, unknown> {
  const proxies = resolveGroupMembers(g, allNodes);
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
  if (g.use && g.use.length > 0) out.use = g.use;
  return out;
}

function resolveGroupMembers(g: ProxyGroup, allNodes: Node[]): string[] {
  const members = new Set<string>(g.proxies);
  if (g.selector) {
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
        // invalid regex
      }
    }
    if (g.selector.exclude_regex) {
      try {
        const re = new RegExp(g.selector.exclude_regex);
        pool = pool.filter((n) => !re.test(n.name));
      } catch {
        // invalid
      }
    }
    for (const n of pool) members.add(n.name);
  }
  if (members.size === 0) members.add("DIRECT");
  return Array.from(members);
}
