/**
 * Authoritative source for internal Node field ↔ Surge parameter translations.
 *
 * Naming convention used in mapping records:
 * - `internal`: the field name used in our internal Node schema (snake_case)
 * - `surge`:    the parameter key emitted in surge .conf output (kebab-case);null = Surge 不输出
 *
 * 内部模型同时也是 Clash YAML / URI 等输入的解析目标,所以有些字段(mptcp、alter_id、
 * congestion_controller 等)只在输入侧有意义,Surge 列为 null。Clash YAML 键 → 内部字段的
 * 映射在 parsers/clash.ts。Refer to docs/protocol-mapping.md for human-readable notes.
 */

export interface FieldMap {
  internal: string;
  surge: string | null;
  /** Notes - especially when value transformation is required */
  notes?: string;
}

/** Common booleans / strings shared across protocols. */
export const COMMON_FIELDS: FieldMap[] = [
  { internal: "tls", surge: "tls", notes: "Surge 端仅 vmess 需要显式 tls=true(默认明文);trojan/https/tuic/hysteria2 等由协议类型隐含,不输出该键" },
  { internal: "sni", surge: "sni" },
  { internal: "name_cert_verify", surge: "server-cert-verify-name", notes: "只改证书 DNSName 校验目标,不改 SNI;Surge 需 iOS 5.21.0+ / Mac 6.8.0+" },
  { internal: "ip_version", surge: "ip-version", notes: "枚举值需映射:内部 dual|ipv4|ipv6|ipv4-prefer|ipv6-prefer ↔ surge dual|v4-only|v6-only|prefer-v4|prefer-v6" },
  { internal: "skip_cert_verify", surge: "skip-cert-verify" },
  { internal: "fingerprint", surge: "server-cert-fingerprint-sha256", notes: "服务器证书 SHA256 锁定(TLS 通用,替代标准 X.509 校验);区别于 client_fingerprint(uTLS 浏览器指纹)" },
  { internal: "client_fingerprint", surge: "tls-fingerprint", notes: "uTLS 客户端指纹(chrome/firefox 等);区别于 fingerprint(证书锁定)" },
  { internal: "alpn", surge: "alpn", notes: "内部为数组;Surge 端(iOS 5.20.0+ / Mac 6.7.0+)数组多值展开为多个 alpn= 参数" },
  { internal: "udp", surge: "udp-relay" },
  { internal: "tfo", surge: "tfo" },
  { internal: "mptcp", surge: null, notes: "Surge 无 per-node mptcp" },
];

/**
 * Shadow TLS 传输层混淆(可叠加在任意 TCP 协议上)。
 *
 * Surge: 任意 proxy 行追加参数(v2: iOS 5.2.0+/Mac 4.10.0+;v3: iOS 5.5.0+/Mac 5.0.3+);
 * version 仅支持 2/3,缺省 2。
 */
export const SHADOW_TLS_FIELDS: FieldMap[] = [
  { internal: "shadow_tls_password", surge: "shadow-tls-password" },
  { internal: "shadow_tls_sni", surge: "shadow-tls-sni", notes: "TLS 握手明文 SNI;Surge 不填则不发 SNI" },
  { internal: "shadow_tls_version", surge: "shadow-tls-version", notes: "Surge 仅 2/3,v1 在 Surge 端跳过 + warning" },
];

/** Shadowsocks-specific. */
export const SHADOWSOCKS_FIELDS: FieldMap[] = [
  { internal: "cipher", surge: "encrypt-method" },
  { internal: "password", surge: "password" },
  { internal: "plugin", surge: null, notes: "Surge uses obfs= for v2ray-plugin/simple-obfs hints" },
];

/** VMess-specific. */
export const VMESS_FIELDS: FieldMap[] = [
  { internal: "uuid", surge: "username", notes: "Surge stores VMess uuid in username field" },
  { internal: "alter_id", surge: null, notes: "Surge does not expose alter id (assumes 0)" },
  { internal: "cipher", surge: "encrypt-method" },
  { internal: "vmess_aead", surge: "vmess-aead" },
];

// VLESS:Surge 不支持该协议(manual.nssurge.com/policies/overview.html 的协议表里没有 vless),
// 输入里的 vless 节点在 Surge 产物中整节点跳过 + warning,故不设映射表。

/** Hysteria2-specific. */
export const HYSTERIA2_FIELDS: FieldMap[] = [
  { internal: "password", surge: "password" },
  // Surge hysteria2 仅支持下行带宽,不支持 upload-bandwidth(manual.nssurge.com/policy/proxy.html)
  { internal: "up", surge: null, notes: "Surge has no upload-bandwidth knob; silently dropped" },
  { internal: "down", surge: "download-bandwidth", notes: "Surge expects plain Mbps integer (no 'Mbps' unit)" },
  // Surge 端没有 hysteria2 的 obfs= 键,混淆按类型用单键表达:
  // salamander → salamander-password=(iOS 5.17.0+ / Mac 6.4.3+)
  // gecko → gecko-password=(iOS 5.20.0+ / Mac 6.7.0+)
  { internal: "obfs", surge: null, notes: "salamander/gecko;Surge 无 obfs= 键,混淆类型由 salamander-password=/gecko-password= 单键隐含" },
  { internal: "obfs_password", surge: "salamander-password", notes: "obfs=salamander → salamander-password=;obfs=gecko → gecko-password=;其他 obfs 类型跳过 + warning" },
  { internal: "port_hopping", surge: "port-hopping" },
  { internal: "hop_interval", surge: "port-hopping-interval" },
];

/** TUIC v5. */
export const TUIC_FIELDS: FieldMap[] = [
  { internal: "uuid", surge: "uuid" },
  { internal: "password", surge: "password" },
  // Surge TUIC v5 必须显式 version=5(无该字段时 Surge 假定 v4 并改读 token)
  { internal: "tuic_version", surge: "version" },
  { internal: "congestion_controller", surge: null },
];

/**
 * WireGuard.
 *
 * 重要:Surge wireguard 用"section-name"模式 — [Proxy] 行只写
 * `<name> = wireguard, section-name=<id>`,密钥/self-ip/peer 全部在单独的
 * `[WireGuard <id>]` 段里(参见 manual.nssurge.com/policy/wireguard.html)。
 * `peers` 在内部模型是数组,在 Surge 是同段内多行 `peer = (...)` 列出。
 */
export const WIREGUARD_FIELDS: FieldMap[] = [
  { internal: "private_key", surge: "private-key", notes: "Surge: in [WireGuard <id>] section" },
  { internal: "public_key", surge: "public-key", notes: "Surge: inside `peer = (public-key=...)`" },
  { internal: "preshared_key", surge: "preshared-key", notes: "Surge: optional inside peer parens" },
  { internal: "ip", surge: "self-ip" },
  { internal: "ipv6", surge: "self-ip-v6" },
  { internal: "reserved", surge: "client-id", notes: "Surge expects 'a/b/c' decimal triplet; auto-conversion not implemented" },
  { internal: "mtu", surge: "mtu" },
  { internal: "peers", surge: "peer", notes: "Multi-peer = repeated `peer = (...)` lines in [WireGuard <id>]" },
];

/**
 * Snell —— Surge 支持 v1–v6,v6 需 iOS 5.20.0+ / Mac 6.7.0+(beta)。
 * 混淆是 `obfs=` + `obfs-host=` 两个平铺参数。
 */
export const SNELL_FIELDS: FieldMap[] = [
  { internal: "psk", surge: "psk" },
  { internal: "snell_version", surge: "version", notes: "Surge 1–6" },
  { internal: "reuse", surge: "reuse", notes: "连接复用,Snell v4+ 可选" },
  { internal: "obfs", surge: "obfs", notes: "Surge v1–v3 支持 http/tls,v4/v5 仅 http,v6 不支持 obfs" },
  { internal: "obfs_host", surge: "obfs-host" },
  { internal: "obfs_uri", surge: "obfs-uri", notes: "仅 obfs=http 有意义" },
];

/** AnyTLS (v2: iOS 5.17.0+ / Mac 6.4.3+)。 */
export const ANYTLS_FIELDS: FieldMap[] = [
  { internal: "password", surge: "password" },
  { internal: "reuse", surge: "reuse", notes: "AnyTLS 规范默认开启复用,reuse=false 显式关闭" },
];

/** Chain proxy field. */
export const CHAIN_FIELDS: FieldMap[] = [
  { internal: "chain_via", surge: "underlying-proxy" },
];

/** Rule flag mapping. */
export const RULE_FLAG_MAP = {
  no_resolve: "no-resolve",
  extended_matching: "extended-matching",
  pre_matching: "pre-matching",
  dns_failed: "dns-failed",
  force_remote_dns: "force-remote-dns",
} as const;

/** REJECT subtype mapping(ruleset.surge_reject_options.type → Surge 策略名)。 */
export const REJECT_TYPE_MAP = {
  REJECT: "REJECT",
  "REJECT-DROP": "REJECT-DROP",
  "REJECT-NO-DROP": "REJECT-NO-DROP",
  "REJECT-TINYGIF": "REJECT-TINYGIF",
} as const;
