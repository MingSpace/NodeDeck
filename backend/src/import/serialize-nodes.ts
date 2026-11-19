import type { Node } from "../schemas/node.js";
import { buildSurgeProxyLine } from "../generators/surge.js";

/**
 * 把一组 Node 序列化成适合塞进 inline Provider `content` 字段的 Surge `[Proxy]` 文本,
 * 后续由 Surge parser 重新读回。
 *
 * 返回值含警告(buildSurgeProxyLine 在跳过节点时会 push warning)以便
 * 上层把它合并到 import 的整体 warnings 里告诉用户"某节点被丢了"之类的事。
 */
export function nodesToInlineContent(nodes: Node[]): { content: string; warnings: string[] } {
  const warnings: string[] = [];
  const lines: string[] = ["[Proxy]"];
  for (const n of nodes) {
    const line = buildSurgeProxyLine(n, warnings);
    if (line) lines.push(line);
  }
  return { content: lines.join("\n") + "\n", warnings };
}
