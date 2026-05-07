import type { Node } from "../schemas/node.js";

/**
 * Parse a Surge .conf [Proxy] section into Node[]. Accepts:
 * - full conf text (we'll find [Proxy] and skip [Proxy Group] etc.)
 * - just the [Proxy] body
 * - 裸代理行(没有 [Proxy] header,逐行作为 surge proxy line 试解析)
 *
 * "裸代理行" 行为参考 subconverter explodeSurge 中的 `set_isolated_items_section("Proxy")`
 * ——上游 2019 年就把 `if(!strFind(surge, "[Proxy]")) return false;` 注释掉了,
 * 因为"local node list"和"测试单节点"等场景里,用户经常只粘贴一行 surge 风格代理。
 */
export function parseSurgeConf(text: string): Node[] {
  const proxySection = extractSection(text, "Proxy");
  const body = proxySection ?? text;
  const fallback = proxySection === null;
  const nodes: Node[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;
    // fallback 模式整文本逐行扫,要跳过其他 section 标头(如 [General] [Proxy Group])。
    if (fallback && /^\[.+\]\s*$/.test(line)) continue;
    const node = parseSurgeProxyLine(line);
    if (node) nodes.push(node);
  }
  return nodes;
}

function extractSection(text: string, sectionName: string): string | null {
  const re = new RegExp(`^\\[\\s*${sectionName}\\s*\\]\\s*$`, "im");
  const lines = text.split(/\r?\n/);
  let inSection = false;
  const collected: string[] = [];
  for (const line of lines) {
    if (re.test(line.trim())) {
      inSection = true;
      continue;
    }
    if (inSection && /^\[.+\]\s*$/.test(line.trim())) {
      break;
    }
    if (inSection) collected.push(line);
  }
  return collected.length > 0 ? collected.join("\n") : null;
}

function stripComment(line: string): string {
  // Surge supports # ; // comments. Also `//` mid-line
  const idx = (() => {
    const candidates = ["#", ";", "//"];
    let min = -1;
    for (const c of candidates) {
      const i = line.indexOf(c);
      if (i >= 0 && (min < 0 || i < min)) {
        // ensure not inside quotes
        const before = line.slice(0, i);
        const dquotes = (before.match(/"/g) ?? []).length;
        if (dquotes % 2 === 0) min = i;
      }
    }
    return min;
  })();
  return idx < 0 ? line : line.slice(0, idx);
}

export function parseSurgeProxyLine(line: string): Node | null {
  const eqIdx = line.indexOf("=");
  if (eqIdx < 0) return null;
  const name = line.slice(0, eqIdx).trim();
  const rhs = line.slice(eqIdx + 1).trim();
  if (!name || !rhs) return null;

  const tokens = splitArgs(rhs);
  if (tokens.length === 0) return null;
  const type = tokens[0].trim().toLowerCase();
  // `direct` is Surge 伪节点 (e.g. `DIRECT = direct` 或 `DIRECT-en0 = direct, interface=en0`)。
  // DIRECT 是 Surge/Clash 的内置策略,本项目两端 generator 也都跳过 direct 节点不输出。
  // 而 nodeSchema 要求 port >= 1,所以这里直接 return null,让 importer 在调用层加 warning。
  if (type === "direct") {
    return null;
  }
  if (tokens.length < 3) return null;
  const server = tokens[1].trim();
  const portStr = tokens[2].trim();
  const port = parseInt(portStr, 10);
  if (!server || !port) return null;

  const params = parseSurgeParams(tokens.slice(3));

  const base = {
    name,
    server,
    port,
    sni: params.sni,
    skip_cert_verify: parseBool(params["skip-cert-verify"]),
    udp: parseBool(params["udp-relay"]) ?? true,
    tfo: parseBool(params.tfo),
    fingerprint: params["tls-fingerprint"],
    client_fingerprint: params["tls-fingerprint"],
    alpn: params.alpn ? [params.alpn] : undefined,
    chain_via: params["underlying-proxy"],
    tags: [],
  } satisfies Partial<Node>;

  switch (type) {
    case "ss":
      return {
        ...base,
        type: "ss",
        cipher: params["encrypt-method"] ?? "aes-128-gcm",
        password: params.password ?? "",
        obfs: params.obfs,
        obfs_host: params["obfs-host"],
        obfs_uri: params["obfs-uri"],
      };
    case "trojan": {
      const node: Node = {
        ...base,
        type: "trojan",
        password: params.password ?? "",
        tls: true,
      };
      if (parseBool(params.ws)) {
        node.network = "ws";
        node.ws_opts = {
          path: params["ws-path"] ?? "/",
          headers: parseSurgeHeaders(params["ws-headers"]),
        };
      }
      return node;
    }
    case "vmess": {
      const node: Node = {
        ...base,
        type: "vmess",
        uuid: params.username ?? "",
        cipher: params["encrypt-method"] ?? "auto",
        vmess_aead: parseBool(params["vmess-aead"]),
      };
      if (parseBool(params.ws)) {
        node.network = "ws";
        node.ws_opts = {
          path: params["ws-path"] ?? "/",
          headers: parseSurgeHeaders(params["ws-headers"]),
        };
      }
      return node;
    }
    case "vless": {
      const node: Node = {
        ...base,
        type: "vless",
        uuid: params.uuid ?? params.username ?? "",
        flow: params["vless-flow"],
        encryption: params.encryption,
        tls: true,
      };
      if (params["reality-public-key"]) {
        node.reality_opts = {
          public_key: params["reality-public-key"]!,
          short_id: params["reality-short-id"] ?? "",
        };
      }
      if (parseBool(params.ws)) {
        node.network = "ws";
        node.ws_opts = {
          path: params["ws-path"] ?? "/",
          headers: parseSurgeHeaders(params["ws-headers"]),
        };
      }
      return node;
    }
    case "hysteria2":
      return {
        ...base,
        type: "hysteria2",
        password: params.password ?? "",
        up: params["upload-bandwidth"],
        down: params["download-bandwidth"],
        obfs: params.obfs,
        obfs_password: params["obfs-password"],
        port_hopping: params["port-hopping"],
        hop_interval: params["port-hopping-interval"]
          ? parseInt(params["port-hopping-interval"], 10)
          : undefined,
        tls: true,
      };
    case "tuic":
      return {
        ...base,
        type: "tuic",
        uuid: params.uuid ?? "",
        password: params.password ?? params.token,
        tuic_version: 5,
        tls: true,
      };
    case "wireguard":
      return {
        ...base,
        type: "wireguard",
        private_key: params["private-key"] ?? "",
        public_key: params["public-key"] ?? "",
        preshared_key: params["preshared-key"],
        ip: params["self-ip"] ?? params.ip,
        ipv6: params["self-ip-v6"] ?? params.ipv6,
        mtu: params.mtu ? parseInt(params.mtu, 10) : undefined,
      };
    case "snell":
      return {
        ...base,
        type: "snell",
        psk: params.psk ?? "",
        snell_version: params.version === "3" || params.version === "4" || params.version === "5"
          ? (parseInt(params.version, 10) as 3 | 4 | 5)
          : 4,
        obfs: params.obfs,
        obfs_host: params["obfs-host"],
      };
    case "anytls":
      return {
        ...base,
        type: "anytls",
        password: params.password ?? "",
        tls: true,
      };
    case "socks5":
    case "socks":
      return {
        ...base,
        type: "socks5",
        username: params.username,
        password: params.password,
      };
    case "socks5-tls":
      return {
        ...base,
        type: "socks5",
        username: params.username,
        password: params.password,
        tls: true,
      };
    case "http":
      return {
        ...base,
        type: "http",
        username: tokens[3]?.trim(),
        password: tokens[4]?.trim(),
      };
    case "https":
      return {
        ...base,
        type: "https",
        username: tokens[3]?.trim(),
        password: tokens[4]?.trim(),
        tls: true,
      };
    default:
      return null;
  }
}

function splitArgs(s: string): string[] {
  // Split by `,` not inside quotes
  const out: string[] = [];
  let depth = 0;
  let inQuote: '"' | "'" | null = null;
  let buf = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuote) {
      buf += ch;
      if (ch === inQuote && s[i - 1] !== "\\") inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      buf += ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf) out.push(buf);
  return out;
}

function parseSurgeParams(tokens: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const t of tokens) {
    const trimmed = t.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) {
      out[trimmed] = "true";
      continue;
    }
    const k = trimmed.slice(0, eqIdx).trim();
    let v = trimmed.slice(eqIdx + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function parseBool(v: string | undefined): boolean | undefined {
  if (v === undefined) return undefined;
  const l = v.toLowerCase();
  if (l === "true" || l === "1" || l === "yes") return true;
  if (l === "false" || l === "0" || l === "no") return false;
  return undefined;
}

function parseSurgeHeaders(s: string | undefined): Record<string, string> {
  if (!s) return {};
  const out: Record<string, string> = {};
  for (const part of s.split("|")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}
