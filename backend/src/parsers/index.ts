import type { Node } from "../schemas/node.js";
import type { Provider } from "../schemas/provider.js";
import { parseClashYaml } from "./clash.js";
import { parseSurgeConf } from "./surge.js";
import { parsePlainUriList, parseV2raySubscription } from "./v2ray.js";

export type ParserHint = Provider["parser_hint"];

export function parseSubscription(text: string, hint: ParserHint = "auto"): Node[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  switch (hint) {
    case "clash":
      return parseClashYaml(trimmed);
    case "surge":
      return parseSurgeConf(trimmed);
    case "v2ray_base64":
      return parseV2raySubscription(trimmed);
    case "ss_links":
    case "trojan_links":
    case "hysteria2_links":
      return parsePlainUriList(trimmed);
    case "auto":
    default:
      return autoDetectAndParse(trimmed);
  }
}

function autoDetectAndParse(text: string): Node[] {
  // 1. clash yaml: starts with `proxies:` or contains it after some yaml prelude
  if (/^\s*(proxies:|---|\w+:)/m.test(text) && /\bproxies\s*:/m.test(text)) {
    const out = parseClashYaml(text);
    if (out.length > 0) return out;
  }
  // 2. surge ini: contains `[Proxy]` section
  if (/^\[\s*Proxy\s*\]/m.test(text)) {
    const out = parseSurgeConf(text);
    if (out.length > 0) return out;
  }
  // 3. plain URI list (one or more lines starting with a known scheme)
  const knownSchemes = /^(ss|ssr|vmess|vless|trojan|hysteria2|hy2|tuic|socks5):\/\//m;
  if (knownSchemes.test(text)) {
    const out = parsePlainUriList(text);
    if (out.length > 0) return out;
  }
  // 4. v2ray base64 fallback
  return parseV2raySubscription(text);
}

export { parseClashYaml, parseSurgeConf, parsePlainUriList, parseV2raySubscription };
export { parseProxyUri } from "./uri.js";
