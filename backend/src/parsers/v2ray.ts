import { Buffer } from "node:buffer";
import { parseProxyUri } from "./uri.js";
import type { Node } from "../schemas/node.js";

/**
 * Parse a v2ray-style subscription:
 * - either base64-encoded blob containing newline-separated proxy URIs
 * - or plain text containing newline-separated URIs
 */
export function parseV2raySubscription(text: string): Node[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const decoded = looksBase64(trimmed) ? safeBase64Decode(trimmed) : trimmed;
  return parsePlainUriList(decoded);
}

export function parsePlainUriList(text: string): Node[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const nodes: Node[] = [];
  for (const line of lines) {
    const node = parseProxyUri(line);
    if (node) nodes.push(node);
  }
  return nodes;
}

function safeBase64Decode(s: string): string {
  try {
    const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
    return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  } catch {
    return s;
  }
}

function looksBase64(s: string): boolean {
  if (s.length < 16) return false;
  if (s.startsWith("ss://") || s.startsWith("vmess://") || s.startsWith("vless://")) return false;
  if (s.startsWith("trojan://") || s.startsWith("hysteria2://") || s.startsWith("tuic://")) return false;
  if (s.startsWith("hy2://")) return false;
  // base64 chars only
  return /^[A-Za-z0-9+/_=\r\n-]+$/.test(s);
}
