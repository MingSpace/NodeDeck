import yaml from "js-yaml";
import { parseHostSection } from "./surge.js";

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
