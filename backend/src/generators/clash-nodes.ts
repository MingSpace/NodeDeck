import type { Node } from "../schemas/node.js";

/**
 * Convert internal Node into a clash mihomo proxy object (plain JS object ready for yaml.dump).
 * Returns null if the node type isn't supported by Clash or required fields are missing.
 */
export function nodeToClashProxy(n: Node): Record<string, unknown> | null {
  switch (n.type) {
    case "ss":
      return ssToClash(n);
    case "ssr":
      return ssrToClash(n);
    case "vmess":
      return vmessToClash(n);
    case "vless":
      return vlessToClash(n);
    case "trojan":
      return trojanToClash(n);
    case "hysteria2":
      return hysteria2ToClash(n);
    case "tuic":
      return tuicToClash(n);
    case "wireguard":
      return wireguardToClash(n);
    case "anytls":
      return anytlsToClash(n);
    case "socks5":
      return socks5ToClash(n);
    case "http":
      return httpToClash(n);
    case "snell":
    case "https":
    case "direct":
    default:
      return null; // not standard clash; skip
  }
}

function setIf<T>(obj: Record<string, unknown>, key: string, value: T | undefined | null): void {
  if (value === undefined || value === null) return;
  if (Array.isArray(value) && value.length === 0) return;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value as object).length === 0) return;
  obj[key] = value;
}

function commonChain(out: Record<string, unknown>, n: Node): void {
  setIf(out, "dialer-proxy", n.chain_via);
}

function commonTls(out: Record<string, unknown>, n: Node): void {
  setIf(out, "tls", n.tls);
  setIf(out, "sni", n.sni);
  setIf(out, "alpn", n.alpn);
  setIf(out, "skip-cert-verify", n.skip_cert_verify);
  setIf(out, "fingerprint", n.fingerprint);
  setIf(out, "client-fingerprint", n.client_fingerprint);
}

function commonNet(out: Record<string, unknown>, n: Node): void {
  setIf(out, "udp", n.udp);
  setIf(out, "tfo", n.tfo);
  setIf(out, "mptcp", n.mptcp);
}

function buildTransport(out: Record<string, unknown>, n: Node): void {
  if (!n.network) return;
  out.network = n.network;
  if (n.network === "ws" && n.ws_opts) {
    const wso: Record<string, unknown> = { path: n.ws_opts.path };
    if (n.ws_opts.headers && Object.keys(n.ws_opts.headers).length > 0) {
      wso.headers = n.ws_opts.headers;
    }
    out["ws-opts"] = wso;
  } else if (n.network === "grpc" && n.grpc_opts) {
    out["grpc-opts"] = { "grpc-service-name": n.grpc_opts.service_name };
  } else if (n.network === "h2" && n.h2_opts) {
    out["h2-opts"] = { path: n.h2_opts.path, host: n.h2_opts.host };
  }
}

function ssToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "ss",
    server: n.server,
    port: n.port,
    cipher: n.cipher ?? "aes-128-gcm",
    password: n.password ?? "",
  };
  commonNet(out, n);
  setIf(out, "plugin", n.plugin);
  setIf(out, "plugin-opts", n.plugin_opts);
  commonChain(out, n);
  return out;
}

function ssrToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "ssr",
    server: n.server,
    port: n.port,
    cipher: n.cipher ?? "",
    password: n.password ?? "",
  };
  commonNet(out, n);
  commonChain(out, n);
  return out;
}

function vmessToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "vmess",
    server: n.server,
    port: n.port,
    uuid: n.uuid ?? "",
    alterId: n.alter_id ?? 0,
    cipher: n.cipher ?? "auto",
  };
  commonNet(out, n);
  commonTls(out, n);
  buildTransport(out, n);
  commonChain(out, n);
  return out;
}

function vlessToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "vless",
    server: n.server,
    port: n.port,
    uuid: n.uuid ?? "",
  };
  commonNet(out, n);
  commonTls(out, n);
  buildTransport(out, n);
  setIf(out, "flow", n.flow);
  setIf(out, "encryption", n.encryption);
  if (n.reality_opts) {
    out["reality-opts"] = {
      "public-key": n.reality_opts.public_key,
      "short-id": n.reality_opts.short_id,
    };
  }
  commonChain(out, n);
  return out;
}

function trojanToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "trojan",
    server: n.server,
    port: n.port,
    password: n.password ?? "",
  };
  commonNet(out, n);
  commonTls(out, n);
  buildTransport(out, n);
  commonChain(out, n);
  return out;
}

function hysteria2ToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "hysteria2",
    server: n.server,
    port: n.port,
    password: n.password ?? "",
  };
  commonNet(out, n);
  commonTls(out, n);
  setIf(out, "up", n.up);
  setIf(out, "down", n.down);
  setIf(out, "obfs", n.obfs);
  setIf(out, "obfs-password", n.obfs_password);
  setIf(out, "ports", n.port_hopping);
  setIf(out, "hop-interval", n.hop_interval);
  commonChain(out, n);
  return out;
}

function tuicToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "tuic",
    server: n.server,
    port: n.port,
    uuid: n.uuid ?? "",
    password: n.password ?? "",
    version: n.tuic_version ?? 5,
  };
  commonNet(out, n);
  commonTls(out, n);
  setIf(out, "congestion-controller", n.congestion_controller);
  commonChain(out, n);
  return out;
}

function wireguardToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "wireguard",
    server: n.server,
    port: n.port,
    "private-key": n.private_key ?? "",
    "public-key": n.public_key ?? "",
  };
  setIf(out, "preshared-key", n.preshared_key);
  setIf(out, "ip", n.ip);
  setIf(out, "ipv6", n.ipv6);
  setIf(out, "reserved", n.reserved);
  setIf(out, "mtu", n.mtu);
  commonNet(out, n);
  commonChain(out, n);
  if (n.peers && n.peers.length > 0) {
    out.peers = n.peers.map((p) => ({
      server: p.server,
      port: p.port,
      "public-key": p.public_key,
      "preshared-key": p.preshared_key,
      "allowed-ips": p.allowed_ips,
      reserved: p.reserved,
    }));
  }
  return out;
}

function anytlsToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "anytls",
    server: n.server,
    port: n.port,
    password: n.password ?? "",
  };
  commonNet(out, n);
  commonTls(out, n);
  commonChain(out, n);
  return out;
}

function socks5ToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "socks5",
    server: n.server,
    port: n.port,
  };
  setIf(out, "username", n.username);
  setIf(out, "password", n.password);
  commonNet(out, n);
  commonTls(out, n);
  commonChain(out, n);
  return out;
}

function httpToClash(n: Node): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: n.name,
    type: "http",
    server: n.server,
    port: n.port,
  };
  setIf(out, "username", n.username);
  setIf(out, "password", n.password);
  commonNet(out, n);
  commonTls(out, n);
  commonChain(out, n);
  return out;
}
