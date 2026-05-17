/**
 * Authoritative source for clash <-> surge field name translations.
 *
 * Naming convention used in mapping records:
 * - `internal`: the field name used in our internal Node schema (snake_case)
 * - `clash`:    the YAML key emitted in clash (Mihomo) output (kebab-case)
 * - `surge`:    the parameter key emitted in surge .conf output (kebab-case)
 *
 * Refer to docs/protocol-mapping.md for human-readable notes.
 */

export interface FieldMap {
  internal: string;
  clash: string | null;
  surge: string | null;
  /** Notes - especially when value transformation is required */
  notes?: string;
}

/** Common booleans / strings shared across protocols. */
export const COMMON_FIELDS: FieldMap[] = [
  { internal: "tls", clash: "tls", surge: "tls" },
  { internal: "sni", clash: "sni", surge: "sni" },
  { internal: "skip_cert_verify", clash: "skip-cert-verify", surge: "skip-cert-verify" },
  { internal: "fingerprint", clash: "fingerprint", surge: null, notes: "Surge uses tls-fingerprint instead" },
  { internal: "client_fingerprint", clash: "client-fingerprint", surge: "tls-fingerprint" },
  { internal: "udp", clash: "udp", surge: "udp-relay" },
  { internal: "tfo", clash: "tfo", surge: "tfo" },
  { internal: "mptcp", clash: "mptcp", surge: null, notes: "Surge does not expose mptcp on per-node basis" },
];

/** Shadowsocks-specific. */
export const SHADOWSOCKS_FIELDS: FieldMap[] = [
  { internal: "cipher", clash: "cipher", surge: "encrypt-method" },
  { internal: "password", clash: "password", surge: "password" },
  { internal: "plugin", clash: "plugin", surge: null, notes: "Surge uses obfs= for v2ray-plugin/simple-obfs hints" },
];

/** VMess-specific. */
export const VMESS_FIELDS: FieldMap[] = [
  { internal: "uuid", clash: "uuid", surge: "username", notes: "Surge stores VMess uuid in username field" },
  { internal: "alter_id", clash: "alterId", surge: null, notes: "Surge does not expose alter id (assumes 0)" },
  { internal: "cipher", clash: "cipher", surge: "encrypt-method" },
  { internal: "vmess_aead", clash: null, surge: "vmess-aead", notes: "Surge-only flag" },
];

/** VLESS-specific. */
export const VLESS_FIELDS: FieldMap[] = [
  { internal: "uuid", clash: "uuid", surge: "username" },
  { internal: "flow", clash: "flow", surge: "vless-flow" },
  { internal: "encryption", clash: "encryption", surge: "encryption" },
  { internal: "reality_opts.public_key", clash: "reality-opts.public-key", surge: "reality-public-key" },
  { internal: "reality_opts.short_id", clash: "reality-opts.short-id", surge: "reality-short-id" },
];

/** Hysteria2-specific. */
export const HYSTERIA2_FIELDS: FieldMap[] = [
  { internal: "password", clash: "password", surge: "password" },
  // Surge 5 hysteria2 仅支持下行带宽,不支持 upload-bandwidth(参见 manual.nssurge.com 第 17 节)
  { internal: "up", clash: "up", surge: null, notes: "Surge has no upload-bandwidth knob; mihomo-only" },
  { internal: "down", clash: "down", surge: "download-bandwidth", notes: "Surge expects plain Mbps integer (no 'Mbps' unit)" },
  { internal: "obfs", clash: "obfs", surge: "obfs" },
  { internal: "obfs_password", clash: "obfs-password", surge: "obfs-password" },
  { internal: "port_hopping", clash: "ports", surge: "port-hopping" },
  { internal: "hop_interval", clash: "hop-interval", surge: "port-hopping-interval" },
];

/** TUIC v5. */
export const TUIC_FIELDS: FieldMap[] = [
  { internal: "uuid", clash: "uuid", surge: "uuid" },
  { internal: "password", clash: "password", surge: "password" },
  // Surge 5 TUIC v5 必须显式 version=5(无该字段时 Surge 假定 v4 并改读 token);
  // mihomo `version: 5` ↔ Surge `version=5`
  { internal: "tuic_version", clash: "version", surge: "version" },
  { internal: "congestion_controller", clash: "congestion-controller", surge: null },
];

/**
 * WireGuard.
 *
 * 重要:Surge 5 wireguard 用"section-name"模式 — [Proxy] 行只写
 * `<name> = wireguard, section-name=<id>`,密钥/self-ip/peer 全部在单独的
 * `[WireGuard <id>]` 段里(参见 manual.nssurge.com/policy/wireguard.html)。
 * 字段键名与 Clash 一致,但表达位置不同:
 *
 *   Clash (mihomo)              Surge 5
 *   ───────────────             ─────────────────────────────
 *   proxy.private-key:          [WireGuard X] private-key
 *   proxy.public-key:           [WireGuard X] peer = (public-key=...)
 *   proxy.ip:                   [WireGuard X] self-ip
 *   proxy.peers[].endpoint:     [WireGuard X] peer = (endpoint=server:port)
 *
 * `peers` 字段在 mihomo 是数组,在 Surge 是同段内多行 `peer = (...)` 列出。
 */
export const WIREGUARD_FIELDS: FieldMap[] = [
  { internal: "private_key", clash: "private-key", surge: "private-key", notes: "Surge: in [WireGuard <id>] section" },
  { internal: "public_key", clash: "public-key", surge: "public-key", notes: "Surge: inside `peer = (public-key=...)`" },
  { internal: "preshared_key", clash: "preshared-key", surge: "preshared-key", notes: "Surge: optional inside peer parens" },
  { internal: "ip", clash: "ip", surge: "self-ip" },
  { internal: "ipv6", clash: "ipv6", surge: "self-ip-v6" },
  { internal: "reserved", clash: "reserved", surge: "client-id", notes: "Surge expects 'a/b/c' decimal triplet; auto-conversion not implemented" },
  { internal: "mtu", clash: "mtu", surge: "mtu" },
  { internal: "peers", clash: "peers", surge: "peer", notes: "Multi-peer = repeated `peer = (...)` lines in [WireGuard <id>]" },
];

/** Snell (Surge-only). */
export const SNELL_FIELDS: FieldMap[] = [
  { internal: "psk", clash: null, surge: "psk" },
  { internal: "snell_version", clash: null, surge: "version" },
  { internal: "obfs", clash: null, surge: "obfs" },
  { internal: "obfs_host", clash: null, surge: "obfs-host" },
];

/** Chain proxy field. */
export const CHAIN_FIELDS: FieldMap[] = [
  { internal: "chain_via", clash: "dialer-proxy", surge: "underlying-proxy" },
];

/** Rule flag mapping. */
export const RULE_FLAG_MAP = {
  no_resolve: { clash: "no-resolve", surge: "no-resolve" },
  extended_matching: { clash: null, surge: "extended-matching" },
  pre_matching: { clash: null, surge: "pre-matching" },
  dns_failed: { clash: null, surge: "dns-failed" },
  force_remote_dns: { clash: null, surge: "force-remote-dns" },
} as const;

/** REJECT subtype mapping. */
export const REJECT_TYPE_MAP = {
  REJECT: { clash: "REJECT", surge: "REJECT" },
  "REJECT-DROP": { clash: "REJECT", surge: "REJECT-DROP" },
  "REJECT-NO-DROP": { clash: "REJECT", surge: "REJECT-NO-DROP" },
  "REJECT-TINYGIF": { clash: "REJECT", surge: "REJECT-TINYGIF" },
} as const;
