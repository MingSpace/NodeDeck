import yaml from "js-yaml";
import type { Node } from "../schemas/node.js";

interface ClashYaml {
  proxies?: ClashProxy[];
}

type ClashProxy = Record<string, unknown> & { type?: string; name?: string };

export function parseClashYaml(text: string): Node[] {
  const parsed = yaml.load(text, { schema: yaml.JSON_SCHEMA }) as ClashYaml | null;
  if (!parsed || !Array.isArray(parsed.proxies)) return [];
  const out: Node[] = [];
  for (const p of parsed.proxies) {
    const node = clashProxyToNode(p);
    if (node) out.push(node);
  }
  return out;
}

function clashProxyToNode(p: ClashProxy): Node | null {
  if (!p.type || !p.name || !p.server || !p.port) return null;
  const port = typeof p.port === "number" ? p.port : parseInt(String(p.port), 10);
  if (!port) return null;

  const base = {
    name: String(p.name),
    server: String(p.server),
    port,
    udp: typeof p.udp === "boolean" ? p.udp : undefined,
    tfo: typeof p.tfo === "boolean" ? p.tfo : undefined,
    mptcp: typeof p.mptcp === "boolean" ? p.mptcp : undefined,
    tls: typeof p.tls === "boolean" ? p.tls : undefined,
    sni: p.sni ? String(p.sni) : (p.servername ? String(p.servername) : undefined),
    skip_cert_verify: typeof p["skip-cert-verify"] === "boolean" ? (p["skip-cert-verify"] as boolean) : undefined,
    fingerprint: p.fingerprint ? String(p.fingerprint) : undefined,
    client_fingerprint: p["client-fingerprint"] ? String(p["client-fingerprint"]) : undefined,
    alpn: Array.isArray(p.alpn) ? (p.alpn as string[]) : undefined,
    chain_via: p["dialer-proxy"] ? String(p["dialer-proxy"]) : undefined,
    tags: [],
  } satisfies Partial<Node>;

  switch (p.type) {
    case "ss": {
      // shadow-tls plugin 归一化到内部 shadow_tls_* 字段(与 Surge 侧共用抽象),
      // 生成 Clash 时由 buildClashProxy 对称重建;其它 plugin(obfs/v2ray-plugin)原样透传。
      // 缺 password 时不做归一化(空串会被两端 generator 的 falsy 判断丢掉整个 plugin),
      // 走下面的透传分支原样保留,保证 roundtrip 不丢字段。
      if (p.plugin === "shadow-tls" && (p["plugin-opts"] as Record<string, unknown> | undefined)?.password) {
        const po = (p["plugin-opts"] as Record<string, unknown>) ?? {};
        const ver = Number(po.version);
        return {
          ...base,
          type: "ss",
          cipher: p.cipher ? String(p.cipher) : "aes-128-gcm",
          password: p.password ? String(p.password) : "",
          shadow_tls_password: String(po.password),
          shadow_tls_sni: po.host ? String(po.host) : undefined,
          shadow_tls_version: ver === 1 || ver === 2 || ver === 3 ? (ver as 1 | 2 | 3) : undefined,
        };
      }
      return {
        ...base,
        type: "ss",
        cipher: p.cipher ? String(p.cipher) : "aes-128-gcm",
        password: p.password ? String(p.password) : "",
        plugin: p.plugin ? String(p.plugin) : undefined,
        plugin_opts: (p["plugin-opts"] as Record<string, unknown>) || undefined,
      };
    }
    case "ssr":
      return {
        ...base,
        type: "ssr",
        cipher: p.cipher ? String(p.cipher) : "",
        password: p.password ? String(p.password) : "",
      };
    case "vmess": {
      const node: Node = {
        ...base,
        type: "vmess",
        uuid: p.uuid ? String(p.uuid) : "",
        alter_id: p.alterId !== undefined ? Number(p.alterId) : (p["alter-id"] !== undefined ? Number(p["alter-id"]) : 0),
        cipher: p.cipher ? String(p.cipher) : "auto",
        network: (p.network as Node["network"]) || undefined,
      };
      applyTransport(node, p);
      return node;
    }
    case "vless": {
      const node: Node = {
        ...base,
        type: "vless",
        uuid: p.uuid ? String(p.uuid) : "",
        flow: p.flow ? String(p.flow) : undefined,
        encryption: p.encryption ? String(p.encryption) : undefined,
        network: (p.network as Node["network"]) || undefined,
      };
      const ro = p["reality-opts"] as Record<string, unknown> | undefined;
      if (ro) {
        node.reality_opts = {
          public_key: String(ro["public-key"] ?? ""),
          short_id: String(ro["short-id"] ?? ""),
        };
      }
      applyTransport(node, p);
      return node;
    }
    case "trojan": {
      const node: Node = {
        ...base,
        type: "trojan",
        password: p.password ? String(p.password) : "",
        tls: p.tls !== false,
        network: (p.network as Node["network"]) || undefined,
      };
      applyTransport(node, p);
      return node;
    }
    case "hysteria2": {
      const ports = p.ports ? String(p.ports) : undefined;
      return {
        ...base,
        type: "hysteria2",
        password: p.password ? String(p.password) : "",
        up: p.up ? String(p.up) : undefined,
        down: p.down ? String(p.down) : undefined,
        obfs: p.obfs ? String(p.obfs) : undefined,
        obfs_password: p["obfs-password"] ? String(p["obfs-password"]) : undefined,
        port_hopping: ports,
        hop_interval: p["hop-interval"] !== undefined ? Number(p["hop-interval"]) : undefined,
        tls: true,
        alpn: Array.isArray(p.alpn) ? (p.alpn as string[]) : ["h3"],
      };
    }
    case "tuic":
      return {
        ...base,
        type: "tuic",
        uuid: p.uuid ? String(p.uuid) : "",
        password: p.password ? String(p.password) : "",
        tuic_version: p.version === 5 || p.version === 4 ? (p.version as 4 | 5) : 5,
        congestion_controller: ["bbr", "cubic", "new_reno"].includes(String(p["congestion-controller"]))
          ? (String(p["congestion-controller"]) as "bbr" | "cubic" | "new_reno")
          : undefined,
        tls: true,
      };
    case "wireguard":
      return {
        ...base,
        type: "wireguard",
        private_key: p["private-key"] ? String(p["private-key"]) : "",
        public_key: p["public-key"] ? String(p["public-key"]) : "",
        preshared_key: p["preshared-key"] ? String(p["preshared-key"]) : undefined,
        ip: p.ip ? String(p.ip) : undefined,
        ipv6: p.ipv6 ? String(p.ipv6) : undefined,
        reserved: p.reserved ? String(p.reserved) : undefined,
        mtu: p.mtu !== undefined ? Number(p.mtu) : undefined,
      };
    case "snell":
      return {
        ...base,
        type: "snell",
        psk: p.psk ? String(p.psk) : "",
        snell_version: p.version === 3 || p.version === 4 || p.version === 5 || p.version === 6 ? (p.version as 3 | 4 | 5 | 6) : 4,
        obfs: (p["obfs-opts"] as Record<string, unknown> | undefined)?.mode
          ? String((p["obfs-opts"] as Record<string, unknown>).mode)
          : undefined,
      };
    case "anytls":
      return {
        ...base,
        type: "anytls",
        password: p.password ? String(p.password) : "",
        tls: true,
      };
    case "socks5":
    case "socks":
      return {
        ...base,
        type: "socks5",
        username: p.username ? String(p.username) : undefined,
        password: p.password ? String(p.password) : undefined,
      };
    case "http":
      return {
        ...base,
        type: "http",
        username: p.username ? String(p.username) : undefined,
        password: p.password ? String(p.password) : undefined,
      };
    default:
      return null;
  }
}

function applyTransport(node: Node, p: ClashProxy): void {
  const network = node.network;
  if (network === "ws") {
    const wso = (p["ws-opts"] as Record<string, unknown> | undefined) ?? {};
    node.ws_opts = {
      path: wso.path ? String(wso.path) : (p["ws-path"] ? String(p["ws-path"]) : "/"),
      headers: (wso.headers as Record<string, string>) ?? (p["ws-headers"] as Record<string, string>) ?? {},
    };
  } else if (network === "grpc") {
    const go = (p["grpc-opts"] as Record<string, unknown> | undefined) ?? {};
    node.grpc_opts = {
      service_name: go["grpc-service-name"] ? String(go["grpc-service-name"]) : "",
    };
  } else if (network === "h2") {
    const ho = (p["h2-opts"] as Record<string, unknown> | undefined) ?? {};
    node.h2_opts = {
      path: ho.path ? String(ho.path) : "/",
      host: Array.isArray(ho.host) ? (ho.host as string[]) : [],
    };
  }
}
