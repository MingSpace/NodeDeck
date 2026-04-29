import { createHash } from "node:crypto";
import type { Node } from "../schemas/node.js";

/**
 * Compute a stable identity for a node based on its protocol-relevant fields.
 * Used for cross-provider deduplication.
 */
export function nodeIdentity(n: Node): string {
  const secret = n.password ?? n.uuid ?? n.psk ?? n.private_key ?? "";
  const key = `${n.type}|${n.server}|${n.port}|${secret}`;
  return createHash("sha1").update(key).digest("hex").slice(0, 16);
}

export interface DedupOptions {
  /** When duplicate is found, keep first occurrence (default) or the one with most fields filled */
  strategy?: "keep-first" | "keep-richest";
}

export function dedupeNodes(nodes: Node[], opts: DedupOptions = {}): Node[] {
  const strategy = opts.strategy ?? "keep-first";
  const map = new Map<string, Node>();
  for (const n of nodes) {
    const id = nodeIdentity(n);
    const existing = map.get(id);
    if (!existing) {
      map.set(id, n);
      continue;
    }
    if (strategy === "keep-richest" && richness(n) > richness(existing)) {
      map.set(id, n);
    }
  }
  return Array.from(map.values());
}

function richness(n: Node): number {
  let score = 0;
  for (const v of Object.values(n)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "object") score += Object.keys(v).length;
    else score += 1;
  }
  return score;
}
