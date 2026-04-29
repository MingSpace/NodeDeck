import { Buffer } from "node:buffer";
import type { Node } from "../schemas/node.js";

/**
 * Parse a single proxy URI (ss://, vmess://, vless://, trojan://, hysteria2://, hy2://, tuic://, ssr://, socks5://).
 * Returns null on parse failure.
 */
export function parseProxyUri(uri: string): Node | null {
  const trimmed = uri.trim();
  if (!trimmed) return null;
  try {
    if (trimmed.startsWith("ss://")) return parseSs(trimmed);
    if (trimmed.startsWith("ssr://")) return parseSsr(trimmed);
    if (trimmed.startsWith("vmess://")) return parseVmess(trimmed);
    if (trimmed.startsWith("vless://")) return parseVless(trimmed);
    if (trimmed.startsWith("trojan://")) return parseTrojan(trimmed);
    if (trimmed.startsWith("hysteria2://") || trimmed.startsWith("hy2://"))
      return parseHysteria2(trimmed);
    if (trimmed.startsWith("tuic://")) return parseTuic(trimmed);
    if (trimmed.startsWith("socks5://") || trimmed.startsWith("socks://"))
      return parseSocks5(trimmed);
  } catch {
    return null;
  }
  return null;
}

function safeUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

function decodeFragment(hash: string): string {
  if (!hash) return "";
  try {
    return decodeURIComponent(hash.replace(/^#/, ""));
  } catch {
    return hash.replace(/^#/, "");
  }
}

function b64decode(s: string): string {
  const padded = s + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

// ---- SS (SIP002) ----
// ss://<base64(method:password)>@host:port#name
// or ss://<base64(method:password@host:port)>#name (legacy)
function parseSs(uri: string): Node | null {
  const fragmentIdx = uri.indexOf("#");
  const main = fragmentIdx >= 0 ? uri.slice(0, fragmentIdx) : uri;
  const name = decodeFragment(uri.slice(fragmentIdx + 1)) || "ss";

  const queryIdx = main.indexOf("?");
  const beforeQuery = queryIdx >= 0 ? main.slice(0, queryIdx) : main;
  const queryStr = queryIdx >= 0 ? main.slice(queryIdx + 1) : "";

  const body = beforeQuery.replace("ss://", "");
  let cipher: string;
  let password: string;
  let server: string;
  let port: number;

  if (body.includes("@")) {
    // SIP002
    const [credPart, hostPart] = body.split("@", 2);
    const decodedCred = looksBase64(credPart) ? b64decode(credPart) : decodeURIComponent(credPart);
    const [c, p] = splitFirst(decodedCred, ":");
    cipher = c;
    password = p;
    const [h, portStr] = splitLast(hostPart.replace(/\/$/, ""), ":");
    server = h;
    port = parseInt(portStr, 10);
  } else {
    // legacy
    const decoded = b64decode(body);
    const m = decoded.match(/^([^:]+):(.+)@([^:]+):(\d+)$/);
    if (!m) return null;
    cipher = m[1];
    password = m[2];
    server = m[3];
    port = parseInt(m[4], 10);
  }

  if (!server || !port) return null;

  const params = new URLSearchParams(queryStr);
  const node: Node = {
    name,
    type: "ss",
    server,
    port,
    cipher,
    password,
    udp: true,
    tags: [],
  };
  const plugin = params.get("plugin");
  if (plugin) {
    const [pluginName, ...rest] = plugin.split(";");
    node.plugin = pluginName;
    if (rest.length) node.plugin_opts = parsePluginOpts(rest.join(";"));
  }
  return node;
}

// ---- SSR ----
// ssr://base64(server:port:protocol:method:obfs:base64pass/?params)
function parseSsr(uri: string): Node | null {
  const decoded = b64decode(uri.replace("ssr://", ""));
  const [main, queryRaw] = decoded.split("/?", 2);
  const parts = main.split(":");
  if (parts.length < 6) return null;
  const [server, portStr, _protocol, cipher, _obfs, passB64] = parts;
  const params = new URLSearchParams(queryRaw ?? "");
  const remarks = params.get("remarks");
  const name = remarks ? b64decode(remarks) : "ssr";
  return {
    name,
    type: "ssr",
    server,
    port: parseInt(portStr, 10),
    cipher,
    password: b64decode(passB64),
    tags: [],
  };
}

// ---- VMess ----
// vmess://<base64(json)>
function parseVmess(uri: string): Node | null {
  const body = uri.replace("vmess://", "").trim();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(b64decode(body));
  } catch {
    return null;
  }
  const port = parseInt(String(payload.port), 10);
  if (!payload.add || !port || !payload.id) return null;
  const node: Node = {
    name: String(payload.ps ?? "vmess"),
    type: "vmess",
    server: String(payload.add),
    port,
    uuid: String(payload.id),
    alter_id: payload.aid ? parseInt(String(payload.aid), 10) : 0,
    cipher: payload.scy ? String(payload.scy) : "auto",
    udp: true,
    tags: [],
  };
  if (payload.tls) node.tls = String(payload.tls) === "tls";
  if (payload.sni) node.sni = String(payload.sni);
  const net = payload.net ? String(payload.net) : "tcp";
  node.network = net as Node["network"];
  if (net === "ws") {
    node.ws_opts = {
      path: String(payload.path ?? "/"),
      headers: payload.host ? { Host: String(payload.host) } : {},
    };
  } else if (net === "grpc") {
    node.grpc_opts = { service_name: String(payload.path ?? "") };
  }
  return node;
}

// ---- VLESS ----
// vless://uuid@host:port?...&flow=...&type=...&security=...#name
function parseVless(uri: string): Node | null {
  const url = safeUrl(uri);
  if (!url) return null;
  const port = parseInt(url.port, 10);
  if (!url.username || !url.hostname || !port) return null;
  const params = url.searchParams;
  const node: Node = {
    name: decodeFragment(url.hash) || "vless",
    type: "vless",
    server: url.hostname,
    port,
    uuid: url.username,
    udp: true,
    tags: [],
  };
  const security = params.get("security") ?? "";
  if (security === "tls" || security === "reality") {
    node.tls = true;
  }
  const sni = params.get("sni") ?? params.get("peer");
  if (sni) node.sni = sni;
  const flow = params.get("flow");
  if (flow) node.flow = flow;
  const fp = params.get("fp");
  if (fp) node.client_fingerprint = fp;
  const alpn = params.get("alpn");
  if (alpn) node.alpn = alpn.split(",").map((s) => s.trim()).filter(Boolean);

  if (security === "reality") {
    node.reality_opts = {
      public_key: params.get("pbk") ?? "",
      short_id: params.get("sid") ?? "",
    };
  }
  const type = params.get("type") ?? "tcp";
  node.network = type as Node["network"];
  if (type === "ws") {
    node.ws_opts = {
      path: params.get("path") ?? "/",
      headers: params.get("host") ? { Host: params.get("host")! } : {},
    };
  } else if (type === "grpc") {
    node.grpc_opts = { service_name: params.get("serviceName") ?? "" };
  }
  return node;
}

// ---- Trojan ----
// trojan://password@host:port?sni=...&allowInsecure=1#name
function parseTrojan(uri: string): Node | null {
  const url = safeUrl(uri);
  if (!url) return null;
  const port = parseInt(url.port, 10);
  if (!url.username || !url.hostname || !port) return null;
  const params = url.searchParams;
  const node: Node = {
    name: decodeFragment(url.hash) || "trojan",
    type: "trojan",
    server: url.hostname,
    port,
    password: decodeURIComponent(url.username),
    udp: true,
    tls: true,
    tags: [],
  };
  const sni = params.get("sni") ?? params.get("peer");
  if (sni) node.sni = sni;
  if (params.get("allowInsecure") === "1") node.skip_cert_verify = true;
  const alpn = params.get("alpn");
  if (alpn) node.alpn = alpn.split(",").map((s) => s.trim()).filter(Boolean);
  const type = params.get("type");
  if (type === "ws") {
    node.network = "ws";
    node.ws_opts = {
      path: params.get("path") ?? "/",
      headers: params.get("host") ? { Host: params.get("host")! } : {},
    };
  }
  return node;
}

// ---- Hysteria2 ----
// hysteria2://password@host:port/?obfs=salamander&obfs-password=xxx&sni=...&insecure=1#name
function parseHysteria2(uri: string): Node | null {
  const url = safeUrl(uri);
  if (!url) return null;
  const port = parseInt(url.port, 10);
  if (!url.username || !url.hostname || !port) return null;
  const params = url.searchParams;
  const node: Node = {
    name: decodeFragment(url.hash) || "hysteria2",
    type: "hysteria2",
    server: url.hostname,
    port,
    password: decodeURIComponent(url.username),
    udp: true,
    tls: true,
    alpn: ["h3"],
    tags: [],
  };
  const sni = params.get("sni");
  if (sni) node.sni = sni;
  if (params.get("insecure") === "1") node.skip_cert_verify = true;
  const obfs = params.get("obfs");
  if (obfs) {
    node.obfs = obfs;
    const obfsPwd = params.get("obfs-password");
    if (obfsPwd) node.obfs_password = obfsPwd;
  }
  return node;
}

// ---- TUIC ----
// tuic://uuid:password@host:port?congestion_control=bbr&alpn=h3&allow_insecure=1#name
function parseTuic(uri: string): Node | null {
  const url = safeUrl(uri);
  if (!url) return null;
  const port = parseInt(url.port, 10);
  if (!url.hostname || !port) return null;
  const params = url.searchParams;
  const node: Node = {
    name: decodeFragment(url.hash) || "tuic",
    type: "tuic",
    server: url.hostname,
    port,
    uuid: decodeURIComponent(url.username),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    udp: true,
    tls: true,
    alpn: ["h3"],
    tuic_version: 5,
    tags: [],
  };
  const sni = params.get("sni");
  if (sni) node.sni = sni;
  if (params.get("allow_insecure") === "1") node.skip_cert_verify = true;
  const cc = params.get("congestion_control");
  if (cc === "bbr" || cc === "cubic" || cc === "new_reno") node.congestion_controller = cc;
  return node;
}

// ---- SOCKS5 ----
function parseSocks5(uri: string): Node | null {
  const url = safeUrl(uri);
  if (!url) return null;
  const port = parseInt(url.port, 10);
  if (!url.hostname || !port) return null;
  return {
    name: decodeFragment(url.hash) || "socks5",
    type: "socks5",
    server: url.hostname,
    port,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    udp: true,
    tags: [],
  };
}

// ---- helpers ----
function splitFirst(s: string, sep: string): [string, string] {
  const i = s.indexOf(sep);
  if (i < 0) return [s, ""];
  return [s.slice(0, i), s.slice(i + sep.length)];
}

function splitLast(s: string, sep: string): [string, string] {
  const i = s.lastIndexOf(sep);
  if (i < 0) return [s, ""];
  return [s.slice(0, i), s.slice(i + sep.length)];
}

function looksBase64(s: string): boolean {
  if (!s) return false;
  if (s.includes(":") || s.includes("@")) return false;
  return /^[A-Za-z0-9+/_-]+={0,3}$/.test(s);
}

function parsePluginOpts(rest: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const part of rest.split(";")) {
    const [k, v] = part.split("=", 2);
    if (k) out[k] = v ?? true;
  }
  return out;
}
