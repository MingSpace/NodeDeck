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
  { internal: "tls", clash: "tls", surge: "tls", notes: "Surge 端仅 vmess 需要显式 tls=true(默认明文);trojan/https/tuic/hysteria2 等由协议类型隐含,不输出该键" },
  { internal: "sni", clash: "sni", surge: "sni" },
  { internal: "skip_cert_verify", clash: "skip-cert-verify", surge: "skip-cert-verify" },
  { internal: "fingerprint", clash: "fingerprint", surge: "server-cert-fingerprint-sha256", notes: "服务器证书 SHA256 锁定(TLS 通用,替代标准 X.509 校验);区别于 client_fingerprint(uTLS 浏览器指纹)" },
  { internal: "client_fingerprint", clash: "client-fingerprint", surge: "tls-fingerprint", notes: "uTLS 客户端指纹(chrome/firefox 等);区别于 fingerprint(证书锁定)" },
  { internal: "alpn", clash: "alpn", surge: "alpn", notes: "Clash 为数组;Surge 端(iOS 5.20.0+ / Mac 6.7.0+)数组多值展开为多个 alpn= 参数" },
  { internal: "udp", clash: "udp", surge: "udp-relay" },
  { internal: "tfo", clash: "tfo", surge: "tfo" },
  { internal: "mptcp", clash: "mptcp", surge: null, notes: "mihomo 通用字段(仅 TCP 协议生效);Surge 无 per-node mptcp" },
];

/**
 * Shadow TLS 传输层混淆(可叠加在任意 TCP 协议上)。
 * - Surge: 任意 proxy 行追加参数(v2: iOS 5.2.0+/Mac 4.10.0+;v3: iOS 5.5.0+/Mac 5.0.3+);
 *   version 仅支持 2/3,缺省 2。
 * - mihomo: 仅 shadowsocks 支持,写法为 `plugin: shadow-tls` + `plugin-opts: { password, host, version }`,
 *   version 支持 1/2/3。其余协议在 Clash 输出降级为跳过该组字段 + warning。
 */
export const SHADOW_TLS_FIELDS: FieldMap[] = [
  { internal: "shadow_tls_password", clash: "plugin-opts.password", surge: "shadow-tls-password" },
  { internal: "shadow_tls_sni", clash: "plugin-opts.host", surge: "shadow-tls-sni", notes: "TLS 握手明文 SNI;Surge 不填则不发 SNI" },
  { internal: "shadow_tls_version", clash: "plugin-opts.version", surge: "shadow-tls-version", notes: "Surge 仅 2/3(缺省 2);v1 在 Surge 端跳过 + warning" },
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
  // Surge hysteria2 仅支持下行带宽,不支持 upload-bandwidth(manual.nssurge.com/policy/proxy.html)
  { internal: "up", clash: "up", surge: null, notes: "Surge has no upload-bandwidth knob; mihomo-only" },
  { internal: "down", clash: "down", surge: "download-bandwidth", notes: "Surge expects plain Mbps integer (no 'Mbps' unit)" },
  // Surge 端没有 hysteria2 的 obfs= 键,混淆按类型用单键表达:
  // salamander → salamander-password=(iOS 5.17.0+ / Mac 6.4.3+)
  // gecko → gecko-password=(iOS 5.20.0+ / Mac 6.7.0+)
  // mihomo 两种混淆都是 obfs: <type> + obfs-password: 两键(wiki.metacubex.one/config/proxies/hysteria2)。
  { internal: "obfs", clash: "obfs", surge: null, notes: "salamander/gecko;Surge 无 obfs= 键,混淆类型由 salamander-password=/gecko-password= 单键隐含" },
  { internal: "obfs_password", clash: "obfs-password", surge: "salamander-password", notes: "obfs=salamander → salamander-password=;obfs=gecko → gecko-password=;其他 obfs 类型跳过 + warning" },
  { internal: "port_hopping", clash: "ports", surge: "port-hopping" },
  { internal: "hop_interval", clash: "hop-interval", surge: "port-hopping-interval" },
];

/** TUIC v5. */
export const TUIC_FIELDS: FieldMap[] = [
  { internal: "uuid", clash: "uuid", surge: "uuid" },
  { internal: "password", clash: "password", surge: "password" },
  // Surge TUIC v5 必须显式 version=5(无该字段时 Surge 假定 v4 并改读 token);
  // mihomo `version: 5` ↔ Surge `version=5`
  { internal: "tuic_version", clash: "version", surge: "version" },
  { internal: "congestion_controller", clash: "congestion-controller", surge: null },
];

/**
 * WireGuard.
 *
 * 重要:Surge wireguard 用"section-name"模式 — [Proxy] 行只写
 * `<name> = wireguard, section-name=<id>`,密钥/self-ip/peer 全部在单独的
 * `[WireGuard <id>]` 段里(参见 manual.nssurge.com/policy/wireguard.html)。
 * 字段键名与 Clash 一致,但表达位置不同:
 *
 *   Clash (mihomo)              Surge
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

/** Snell (Surge-only). v6 需 iOS 5.20.0+ / Mac 6.7.0+(beta,不支持 QUIC Proxy Mode)。 */
export const SNELL_FIELDS: FieldMap[] = [
  { internal: "psk", clash: null, surge: "psk" },
  { internal: "snell_version", clash: null, surge: "version", notes: "3/4/5/6;v6 派生流量特征,无额外客户端参数" },
  { internal: "reuse", clash: null, surge: "reuse", notes: "连接复用,Snell v4+ 可选" },
  { internal: "obfs", clash: null, surge: "obfs" },
  { internal: "obfs_host", clash: null, surge: "obfs-host" },
];

/** AnyTLS (v2: iOS 5.17.0+ / Mac 6.4.3+)。 */
export const ANYTLS_FIELDS: FieldMap[] = [
  { internal: "password", clash: "password", surge: "password" },
  { internal: "reuse", clash: null, surge: "reuse", notes: "AnyTLS 规范默认开启复用,reuse=false 显式关闭;mihomo 无此键" },
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
