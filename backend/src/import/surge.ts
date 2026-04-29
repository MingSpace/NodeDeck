import { parseSurgeConf } from "../parsers/surge.js";
import { annotateNodes } from "../parsers/normalize.js";
import type { Node } from "../schemas/node.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import type { SurgeModule } from "../schemas/surge-module.js";

export interface SurgeImportResult {
  general?: GeneralPreset;
  manualNodes: Node[];
  ruleSets: RuleSet[];
  proxyGroups: ProxyGroup[];
  modules: SurgeModule[];
  warnings: string[];
}

export function importSurgeConf(text: string): SurgeImportResult {
  const warnings: string[] = [];

  const general = parseGeneralSection(text);
  const hostMap = parseHostSection(text);
  if (general && Object.keys(hostMap).length > 0) {
    general.hosts = { ...general.hosts, ...hostMap };
  }

  const mitmFromText = parseMitmSection(text);
  if (general && mitmFromText) {
    general.mitm = mitmFromText;
  }

  const manualNodes = annotateNodes(parseSurgeConf(text));

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

function extractSection(text: string, name: string): string | null {
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

function parseGeneralSection(text: string): GeneralPreset | undefined {
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
  return {
    id: "imported",
    name: "Imported from Surge",
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
    skip_proxy: kv["skip-proxy"]?.split(",").map((s) => s.trim()),
    exclude_simple_hostnames: kv["exclude-simple-hostnames"] === "true",
    always_real_ip: kv["always-real-ip"]?.split(",").map((s) => s.trim()),
    show_error_page_for_reject: kv["show-error-page-for-reject"] === "true",
    dns: {
      enable: true,
      server: kv["dns-server"]?.split(",").map((s) => s.trim()),
      encrypted_server: kv["encrypted-dns-server"]?.split(",").map((s) => s.trim()),
      hijack: kv["hijack-dns"]?.split(",").map((s) => s.trim()),
    },
  };
}

function parseHostSection(text: string): Record<string, string> {
  const body = extractSection(text, "Host");
  if (!body) return {};
  const out: Record<string, string> = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    const k = line.slice(0, idx).trim();
    const v = line.slice(idx + 1).trim();
    if (k && v) out[k] = v;
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
    let counter = 0;
    for (const raw of rulesBody.split(/\r?\n/)) {
      const line = stripComment(raw).trim();
      if (!line) continue;
      const ruleMatch = line.match(/^RULE-SET\s*,\s*([^,]+)\s*,\s*([A-Za-z0-9-_+]+)/i);
      if (!ruleMatch) continue;
      const url = ruleMatch[1].trim();
      const policy = ruleMatch[2].trim();
      if (!url.startsWith("http")) continue; // skip SYSTEM/LAN internal sets
      counter++;
      const id = `imported-rule-${counter}`;
      const flagsPart = line.slice(ruleMatch[0].length).split(",").map((s) => s.trim());
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
        behavior: "classical",
        format: "yaml",
        policy: rejectType ? "REJECT" : policy,
        surge_flags: Object.keys(flags).length > 0 ? flags : undefined,
        surge_reject_options: rejectType
          ? { type: rejectType, notification_text: notificationText, notification_interval: notificationInterval }
          : undefined,
        clash_format: "rule_provider",
        surge_format: "rule_set",
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
        id: `imported-${slugify(name)}`,
        name,
        type: ["select", "url-test", "fallback", "load-balance", "smart", "ssid", "external"].includes(type as string)
          ? (type as ProxyGroup["type"])
          : "select",
        proxies,
        url: params.url,
        interval: params.interval ? parseInt(params.interval, 10) : undefined,
        tolerance: params.tolerance ? parseInt(params.tolerance, 10) : undefined,
        timeout: params.timeout ? parseInt(params.timeout, 10) : undefined,
      });
    }
  }

  return { ruleSets, proxyGroups, warnings };
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
      id: "imported-module",
      name: "Imported Module",
      description: "Module sections imported from Surge .conf",
      enabled_by_default: true,
      content_sections: {
        url_rewrite: sections["URL Rewrite"],
        header_rewrite: sections["Header Rewrite"],
        body_rewrite: sections["Body Rewrite"],
        script: sections["Script"],
      },
    },
  ];
}

function stripComment(line: string): string {
  for (const c of ["#", ";", "//"]) {
    const i = line.indexOf(c);
    if (i >= 0) return line.slice(0, i);
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

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "group";
}
