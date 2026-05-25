import yaml from "js-yaml";
import { parseClashYaml } from "../parsers/clash.js";
import { annotateNodes } from "../parsers/normalize.js";
import type { Node } from "../schemas/node.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { GeneralPreset } from "../schemas/general-preset.js";
import { generateImportedId } from "./id.js";

export interface ClashImportResult {
  general?: GeneralPreset;
  manualNodes: Node[];
  ruleSets: RuleSet[];
  proxyGroups: ProxyGroup[];
  warnings: string[];
}

interface ClashConfig {
  port?: number;
  "socks-port"?: number;
  "mixed-port"?: number;
  "allow-lan"?: boolean;
  mode?: string;
  "log-level"?: string;
  ipv6?: boolean;
  hosts?: Record<string, string>;
  proxies?: unknown[];
  "proxy-groups"?: unknown[];
  rules?: string[];
  "rule-providers"?: Record<
    string,
    { type?: string; behavior?: string; url?: string; format?: string; interval?: number }
  >;
  dns?: {
    enable?: boolean;
    listen?: string;
    nameserver?: string[];
    fallback?: string[];
    "fake-ip-range"?: string;
    "enhanced-mode"?: string;
  };
}

export function importClashYaml(text: string, fileName?: string): ClashImportResult {
  const parsed = yaml.load(text) as ClashConfig | null;
  const warnings: string[] = [];
  if (!parsed) return { manualNodes: [], ruleSets: [], proxyGroups: [], warnings: ["empty yaml"] };

  const manualNodes = annotateNodes(parseClashYaml(text));

  const trimmedFile = fileName?.trim();
  const general: GeneralPreset = {
    id: generateImportedId(trimmedFile && trimmedFile.length > 0 ? trimmedFile : "clash"),
    name: `Imported from ${trimmedFile && trimmedFile.length > 0 ? trimmedFile : "Clash"}`,
    port: parsed.port,
    socks_port: parsed["socks-port"],
    mixed_port: parsed["mixed-port"],
    allow_lan: parsed["allow-lan"] ?? false,
    mode: (parsed.mode as GeneralPreset["mode"]) ?? "rule",
    log_level: (parsed["log-level"] as GeneralPreset["log_level"]) ?? "info",
    ipv6: parsed.ipv6 ?? false,
    hosts: parsed.hosts,
    dns: parsed.dns
      ? {
          enable: parsed.dns.enable ?? true,
          listen: parsed.dns.listen,
          nameserver: parsed.dns.nameserver,
          fallback: parsed.dns.fallback,
          fake_ip_range: parsed.dns["fake-ip-range"],
          enhanced_mode: parsed.dns["enhanced-mode"] === "fake-ip" ? "fake-ip" : parsed.dns["enhanced-mode"] === "redir-host" ? "redir-host" : undefined,
        }
      : undefined,
  };

  const ruleSets: RuleSet[] = [];
  if (parsed["rule-providers"]) {
    for (const [name, def] of Object.entries(parsed["rule-providers"])) {
      ruleSets.push({
        id: generateImportedId(name),
        name,
        type: "remote_url",
        url: def.url ?? "",
        behavior: (def.behavior as RuleSet["behavior"]) ?? "classical",
        format: (def.format as RuleSet["format"]) ?? "yaml",
        clash_format: "rule_provider",
        surge_format: "rule_set",
        update_interval: def.interval ?? 86400,
      });
    }
  }
  // also check inline rules for RULE-SET references
  if (parsed.rules) {
    for (const r of parsed.rules) {
      if (typeof r !== "string") continue;
      const m = r.match(/^RULE-SET,([^,]+),(.+)$/);
      if (!m) continue;
      const refName = m[1].trim();
      // if not already in rule-providers (could be inline list reference) - skip for now
      if (!ruleSets.find((rs) => rs.name === refName)) {
        // possibly we should warn
      }
    }
  }

  const proxyGroups: ProxyGroup[] = [];
  if (parsed["proxy-groups"] && Array.isArray(parsed["proxy-groups"])) {
    for (const raw of parsed["proxy-groups"] as Array<Record<string, unknown>>) {
      if (!raw.name || !raw.type) continue;
      proxyGroups.push({
        id: generateImportedId(String(raw.name)),
        name: String(raw.name),
        type: (String(raw.type) as ProxyGroup["type"]),
        proxies: Array.isArray(raw.proxies) ? (raw.proxies as string[]) : [],
        // Clash 导入侧暂不主动识别嵌套组(client yaml 里的组名引用直接在 proxies 数组里,
        // 跟节点名/builtin 混在一起且无字段区分);留空数组让后续 schema parse 直通。
        // 想拆分的用户可以在 Web UI 编辑该组时手动把组名挪到嵌套引用 chip。
        nested_groups: [],
        url: typeof raw.url === "string" ? raw.url : undefined,
        interval: typeof raw.interval === "number" ? raw.interval : undefined,
        tolerance: typeof raw.tolerance === "number" ? raw.tolerance : undefined,
        timeout: typeof raw.timeout === "number" ? raw.timeout : undefined,
      });
    }
  }

  return { general, manualNodes, ruleSets, proxyGroups, warnings };
}
