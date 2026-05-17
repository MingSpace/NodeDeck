import yaml from "js-yaml";
import type { Node } from "../schemas/node.js";
import { buildClashProxy } from "../generators/clash.js";
import { buildSurgeProxyLine } from "../generators/surge.js";

export type SerializeKind = "clash" | "surge";

/**
 * 把一组 Node 序列化成适合塞进 inline Provider `content` 字段的文本。
 *
 * 为什么按 kind 分两条路径而不是统一一种格式:
 * - Clash YAML 装不下 snell(Surge-only,Clash 没有这个 type);
 * - Surge .conf 装不下 ssr 等 Clash-only 协议。
 * 顺着导入来源的原生格式走,字段保真度最高,后续被对应 parser 重新读回时也最接近 round-trip。
 *
 * 返回值含警告(buildClashProxy / buildSurgeProxyLine 在跳过节点时会 push warning)以便
 * 上层把它合并到 import 的整体 warnings 里告诉用户"snell 节点被丢了"之类的事。
 */
export function nodesToInlineContent(
  nodes: Node[],
  kind: SerializeKind,
): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  if (kind === "clash") {
    const proxies = nodes
      .map((n) => buildClashProxy(n, warnings))
      .filter((p): p is Record<string, unknown> => p !== null);
    const content = yaml.dump({ proxies }, { noRefs: true, lineWidth: 200, sortKeys: false });
    return { content, warnings };
  }
  // surge
  const lines: string[] = ["[Proxy]"];
  for (const n of nodes) {
    const line = buildSurgeProxyLine(n, warnings);
    if (line) lines.push(line);
  }
  return { content: lines.join("\n") + "\n", warnings };
}
