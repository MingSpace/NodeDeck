import type { Node } from "../schemas/node.js";
import type { Provider } from "../schemas/provider.js";
import { parseClashYaml } from "./clash.js";
import { parseSurgeConf, parseSurgeProxyLine } from "./surge.js";
import { parsePlainUriList, parseV2raySubscription } from "./v2ray.js";
import { parseProxyUri } from "./uri.js";

export type ParserHint = Provider["parser_hint"];

// 已知 surge 风格代理类型,用于识别"裸代理行"(无 [Proxy] header)。
// 注意:必须严格匹配 `<name> = <type>, <host>, <port>` 结构,否则会误把 INI/yaml 行当成代理行。
const SURGE_PROXY_TYPES = [
  "ss",
  "ssr",
  "trojan",
  "vmess",
  "vless",
  "hysteria2",
  "hy2",
  "tuic",
  "wireguard",
  "snell",
  "anytls",
  "socks5",
  "socks5-tls",
  "http",
  "https",
  "direct",
] as const;
const BARE_SURGE_LINE_RE = new RegExp(
  String.raw`^[^=\n]+=\s*(${SURGE_PROXY_TYPES.join("|")})\s*,`,
  "im",
);
const URI_LINE_RE = /^(ss|ssr|vmess|vless|trojan|hysteria2|hy2|tuic|socks5|socks):\/\//;

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
    case "mixed":
      return parseMixedLines(trimmed);
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
  if (/^(ss|ssr|vmess|vless|trojan|hysteria2|hy2|tuic|socks5):\/\//m.test(text)) {
    const out = parsePlainUriList(text);
    if (out.length > 0) return out;
  }
  // 4. bare surge proxy lines (no [Proxy] header)
  // 参考 subconverter explodeSurge 的 `set_isolated_items_section("Proxy")`:游离行被自动当作 Proxy 段。
  // 我们用更克制的方式:仅当至少有一行匹配 `<name> = <type>, ...` 时才走 surge fallback,
  // 避免误识别 yaml flow / ini 配置等"看起来像但不是"的格式。
  if (BARE_SURGE_LINE_RE.test(text)) {
    const out = parseSurgeConf(text);
    if (out.length > 0) return out;
  }
  // 5. v2ray base64 fallback
  return parseV2raySubscription(text);
}

/**
 * 逐行 try-each-parser,允许同一份文本里混合 URI 和 Surge 风格代理行。
 *
 * 设计参考 Sub-Store backend/src/core/proxy-utils/index.js:
 * - 每行独立尝试每种 parser,任一成功即采用
 * - 失败行静默跳过(注释/空行/无法识别都不算错误)
 *
 * 与 auto 不同:auto 是"整文本一次定型",mixed 是"逐行混合"。
 * 适合"local node list"或多机场单节点拼盘。
 */
function parseMixedLines(text: string): Node[] {
  const nodes: Node[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^[#;]/.test(line) || line.startsWith("//")) continue;
    if (/^\[.+\]\s*$/.test(line)) continue;

    if (URI_LINE_RE.test(line)) {
      const uriNode = parseProxyUri(line);
      if (uriNode) {
        nodes.push(uriNode);
        continue;
      }
    }
    if (line.includes("=")) {
      const surgeNode = parseSurgeProxyLine(line);
      if (surgeNode) {
        nodes.push(surgeNode);
        continue;
      }
    }
  }
  return nodes;
}

export { parseClashYaml, parseSurgeConf, parsePlainUriList, parseV2raySubscription };
export { parseProxyUri } from "./uri.js";
