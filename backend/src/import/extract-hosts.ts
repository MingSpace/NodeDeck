import { isIP } from "node:net";
import yaml from "js-yaml";
import { parseHostSection, extractSection, stripComment } from "./surge.js";
import { mergeHostMaps } from "../generators/hosts.js";

export type HostMap = Record<string, string | string[]>;

export interface ExtractHostsResult {
  hosts: HostMap;
  /** 命中的来源格式;none 表示该订阅不含可抽取的 hosts 段。 */
  format: "clash" | "surge" | "none";
}

/** 把上游 hosts value 规整成 provider schema 接受的 string | string[](去空、单值塌成字符串)。 */
function sanitizeHostMap(raw: Record<string, unknown>): HostMap {
  const out: HostMap = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.trim();
    if (!key) continue;
    const values = (Array.isArray(v) ? v : [v])
      .map((x) => (x == null ? "" : String(x).trim()))
      .filter((x) => x.length > 0);
    if (values.length === 0) continue;
    out[key] = values.length === 1 ? values[0] : values;
  }
  return out;
}

/**
 * 从一段订阅文本里抽取「上游自带的」host 映射:
 * - Clash YAML:顶层 `hosts:` map(mihomo 顶层 hosts 段)
 * - Surge conf:`[Host]` 段(复用整包导入的 parseHostSection)
 *
 * base64 / URI 列表本身不含 hosts 段,返回 format: "none"。
 */
export function extractHostsFromText(text: string): ExtractHostsResult {
  if (text.trim().length === 0) return { hosts: {}, format: "none" };

  // 1) 先按 Clash YAML 试:顶层是 mapping 且含 hosts
  try {
    const parsed = yaml.load(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const hosts = (parsed as { hosts?: unknown }).hosts;
      if (hosts && typeof hosts === "object" && !Array.isArray(hosts)) {
        const clean = sanitizeHostMap(hosts as Record<string, unknown>);
        if (Object.keys(clean).length > 0) return { hosts: clean, format: "clash" };
      }
    }
  } catch {
    // 不是合法 YAML(多半是 Surge conf / base64),落到下面 Surge 分支。
  }

  // 2) 再按 Surge [Host] 段试
  const surgeHosts = parseHostSection(text);
  if (Object.keys(surgeHosts).length > 0) return { hosts: surgeHosts, format: "surge" };

  return { hosts: {}, format: "none" };
}

/**
 * 从 Surge `[General]` 段抽 `encrypted-dns-server` 的 DoH 列表(逗号分隔,可多行累积)。
 * 机场常把自建 DoH 设为全局加密 DNS 来抗节点域名污染(Nexitally 风格:[Host] 为空,
 * 防污染全压在这层)。这是 Surge 概念,Clash 订阅无此键,返回空数组。
 */
export function extractEncryptedDnsServers(text: string): string[] {
  const body = extractSection(text, "General");
  if (!body) return [];
  const out: string[] = [];
  for (const raw of body.split(/\r?\n/)) {
    const line = stripComment(raw).trim();
    if (!line || !line.includes("=")) continue;
    const idx = line.indexOf("=");
    if (line.slice(0, idx).trim().toLowerCase() !== "encrypted-dns-server") continue;
    for (const v of line.slice(idx + 1).split(",")) {
      const t = v.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

/** 域名比较前规整:小写 + 去尾点(`example.com.` → `example.com`)。 */
function normalizeDomain(d: string): string {
  return d.trim().toLowerCase().replace(/\.$/, "");
}

interface HostKeyShape {
  /** key 以 DOMAIN-SET: / RULE-SET: 开头(批量绑定,非单域名)。 */
  batch: boolean;
  /** key 为通配:`*.x` / `+.x` / `.x`。 */
  wildcard: boolean;
  /** 规整后的基域(通配去掉前缀);batch 时为空串。 */
  base: string;
}

function parseHostKey(key: string): HostKeyShape {
  const k = key.trim();
  const upper = k.toUpperCase();
  if (upper.startsWith("DOMAIN-SET:") || upper.startsWith("RULE-SET:")) {
    return { batch: true, wildcard: false, base: "" };
  }
  if (k.startsWith("*.")) return { batch: false, wildcard: true, base: normalizeDomain(k.slice(2)) };
  if (k.startsWith("+.")) return { batch: false, wildcard: true, base: normalizeDomain(k.slice(2)) };
  if (k.startsWith(".")) return { batch: false, wildcard: true, base: normalizeDomain(k.slice(1)) };
  return { batch: false, wildcard: false, base: normalizeDomain(k) };
}

/**
 * 判断一条 host 是否服务于给定节点 server 域名集合中的某个域名:
 * - 精确 key:与某 server 域名相等;
 * - 通配 key(`*.x`/`+.x`/`.x`):某 server 域名等于 x 或是 x 的子域;
 * - 批量(DOMAIN-SET:/RULE-SET:)与 IP key 一律不命中
 *   (IP 节点不进 serverDomains,也无需 DNS 解析)。
 */
export function domainKeyMatchesServers(key: string, serverDomains: Iterable<string>): boolean {
  const shape = parseHostKey(key);
  if (shape.batch || !shape.base || isIP(shape.base) !== 0) return false;
  for (const raw of serverDomains) {
    const server = normalizeDomain(raw);
    if (!server) continue;
    if (shape.wildcard) {
      if (server === shape.base || server.endsWith(`.${shape.base}`)) return true;
    } else if (server === shape.base) {
      return true;
    }
  }
  return false;
}

/** 只保留 key 与本源节点 server 域名相关的 host 条目,丢弃无关条目(国内域名分流等)。 */
export function filterHostsByNodeDomains(hosts: HostMap, serverDomains: Iterable<string>): HostMap {
  const out: HostMap = {};
  for (const [key, value] of Object.entries(hosts)) {
    if (domainKeyMatchesServers(key, serverDomains)) out[key] = value;
  }
  return out;
}

export interface DeriveHostOverridesInput {
  /** 节点源原始订阅文本。 */
  text: string;
  /** 本源解析出的节点 server 列表(域名 + IP 混合,函数内部自行剔除 IP)。 */
  nodeServerDomains: string[];
}

/**
 * 生成"只服务于本源节点域名"的 host 覆盖(写入 cache.extracted_hosts),两路来源合并去重:
 * 1. 上游 [Host]/hosts: 中命中本源节点 server 域名的条目(精确 + 通配父域);
 * 2. Surge encrypted-dns-server(机场自建 DoH)→ 为每个域名型 server 推导
 *    `节点域名 = server:<DoH>`,让客户端用机场 DoH 解析节点域名抗污染。
 * 节点 server 为 IP 的跳过;sni 不参与(不发起连接、无需解析)。
 */
export function deriveProviderHostOverrides(input: DeriveHostOverridesInput): HostMap {
  const domainServers = Array.from(
    new Set(
      input.nodeServerDomains
        .map((s) => normalizeDomain(s))
        .filter((s) => s.length > 0 && isIP(s) === 0),
    ),
  );

  const filtered = filterHostsByNodeDomains(extractHostsFromText(input.text).hosts, domainServers);

  const derived: HostMap = {};
  const dohList = extractEncryptedDnsServers(input.text);
  if (dohList.length > 0 && domainServers.length > 0) {
    const serverValues = dohList.map((d) => `server:${d}`);
    for (const domain of domainServers) derived[domain] = serverValues;
  }

  // mergeHostMaps 统一成数组并去重;sanitizeHostMap 把单值塌回字符串,保持与旧格式一致。
  return sanitizeHostMap(mergeHostMaps(filtered, derived));
}
