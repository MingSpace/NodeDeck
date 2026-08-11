import { z } from "zod";
import { tagsSchema, regionCodeSchema, namedRefSchema } from "./common.js";

/**
 * Field-level target annotation used in Node definitions:
 * - [CS] both Clash and Surge support this field (with possibly different keys)
 * - [C]  Clash-only (mihomo); ignored in Surge generator
 * - [S]  Surge-only; ignored in Clash generator
 */

export const nodeTypeSchema = z.enum([
  "ss", // [CS]
  "ssr", // [C] (Surge dropped support)
  "vmess", // [CS]
  "vless", // [CS]
  "trojan", // [CS]
  "hysteria2", // [CS]
  "tuic", // [CS]
  "wireguard", // [CS]
  "snell", // [S]
  "anytls", // [CS]
  "socks5", // [CS]
  "http", // [CS]
  "https", // [S]
  "direct", // [CS] (special)
]);
export type NodeType = z.infer<typeof nodeTypeSchema>;

const wsOptsSchema = z.object({
  path: z.string().default("/"),
  headers: z.record(z.string()).default({}),
  early_data_header_name: z.string().optional(),
  max_early_data: z.number().int().nonnegative().optional(),
});

const grpcOptsSchema = z.object({
  service_name: z.string().default(""),
});

const h2OptsSchema = z.object({
  path: z.string().default("/"),
  host: z.array(z.string()).default([]),
});

const realityOptsSchema = z.object({
  public_key: z.string(),
  short_id: z.string().default(""),
});

const wgPeerSchema = z.object({
  server: z.string(),
  port: z.number().int().min(1).max(65535),
  public_key: z.string(),
  preshared_key: z.string().optional(),
  allowed_ips: z.array(z.string()).default(["0.0.0.0/0", "::/0"]),
  reserved: z.string().optional(),
  /** [CS] NAT 保活间隔(秒);clash:`persistent-keepalive`, surge: peer 括号内 `keepalive=` */
  keepalive: z.number().int().min(0).max(65535).optional(),
});

export const nodeSchema = z.object({
  // identification
  name: z.string().min(1),
  type: nodeTypeSchema,

  // [CS] generic transport
  server: z.string().min(1),
  port: z.number().int().min(1).max(65535),

  // [CS] credentials (one of these depending on type)
  password: z.string().optional(), // ss / trojan / hysteria2 / snell-psk / anytls
  uuid: z.string().optional(), // vmess / vless / tuic
  cipher: z.string().optional(), // ss + 2022-blake3-* ciphers; clash:`cipher`, surge:`encrypt-method`

  // [CS] TLS family
  tls: z.boolean().optional(),
  sni: z.string().optional(),
  alpn: z.array(z.string()).optional(),
  skip_cert_verify: z.boolean().optional(),
  fingerprint: z.string().optional(), // [CS] 服务器证书 SHA256 锁定; clash:`fingerprint`, surge:`server-cert-fingerprint-sha256`
  client_fingerprint: z.string().optional(), // [CS] uTLS 客户端指纹; clash:`client-fingerprint`, surge:`tls-fingerprint`
  /**
   * @deprecated 不要写入。`sni` 才是内部唯一真相 —— parser 读到 clash 的 `servername` 会折叠进 `sni`,
   * generator 再按协议决定输出 `sni` 还是 `servername`(mihomo 的 vmess/vless 只认后者)。
   * 保留字段仅为兼容存量 yaml,不会被任何 generator 读取。
   */
  servername: z.string().optional(),
  /** [CS] 只改证书 DNSName 校验目标,不改 SNI; clash:`name-cert-verify`, surge:`server-cert-verify-name`(iOS 5.21.0+ / Mac 6.8.0+) */
  name_cert_verify: z.string().optional(),

  // [CS] common knobs
  udp: z.boolean().optional(), // clash:`udp`, surge:`udp-relay`
  tfo: z.boolean().optional(),
  mptcp: z.boolean().optional(),
  /**
   * [CS] IPv4 / IPv6 选择。内部统一用 mihomo 的枚举,Surge 端由 generator 映射
   * (dual→dual / ipv4→v4-only / ipv6→v6-only / ipv4-prefer→prefer-v4 / ipv6-prefer→prefer-v6)。
   */
  ip_version: z.enum(["dual", "ipv4", "ipv6", "ipv4-prefer", "ipv6-prefer"]).optional(),

  // [S] 节点级测速覆盖。Surge 现行版本已废弃策略组行上的 `url=`,per-policy 的这三个键
  // 与 [General] 的 proxy-test-url / test-timeout 才是仅有的入口(解析顺序:节点 → 全局 → 默认)。
  // mihomo 没有节点级测速概念(测速 URL 只存在于 proxy-group 上),Clash 输出忽略。
  test_url: z.string().url().optional(),
  test_timeout: z.number().int().min(1).max(60).optional(),
  /** `hostname@ipv4` 形式,如 `google.com@1.1.1.1` */
  test_udp: z.string().optional(),

  // [CS] transport
  network: z.enum(["tcp", "udp", "ws", "grpc", "h2", "http"]).optional(),
  ws_opts: wsOptsSchema.optional(),
  grpc_opts: grpcOptsSchema.optional(), // [C] mostly
  h2_opts: h2OptsSchema.optional(),

  // [CS] vmess / vless extras
  alter_id: z.number().int().nonnegative().optional(), // [CS] vmess
  vmess_aead: z.boolean().optional(), // [S]
  flow: z.string().optional(), // [CS] vless: xtls-rprx-vision
  reality_opts: realityOptsSchema.optional(), // [CS]
  encryption: z.string().optional(), // [CS] vless

  // [CS] hysteria2
  up: z.string().optional(), // "100 Mbps"
  down: z.string().optional(),
  obfs: z.string().optional(), // hysteria2 / shadowsocks
  obfs_password: z.string().optional(),
  port_hopping: z.string().optional(), // [CS] clash:`ports`, surge:`port-hopping`
  hop_interval: z.number().int().min(5).max(300).optional(),

  // [C] tuic v5
  congestion_controller: z.enum(["bbr", "cubic", "new_reno"]).optional(),
  tuic_version: z.union([z.literal(4), z.literal(5)]).optional(),

  // [CS] wireguard
  private_key: z.string().optional(),
  public_key: z.string().optional(),
  preshared_key: z.string().optional(),
  ip: z.string().optional(),
  ipv6: z.string().optional(),
  reserved: z.string().optional(),
  // Surge 手册给的范围是 576–1420(默认 1280);这里不收紧上界以免让存量 yaml 失效,
  // 超出时由 Surge generator 发 warning。
  mtu: z.number().int().min(576).max(9000).optional(),
  peers: z.array(wgPeerSchema).optional(), // [C] only
  /**
   * [S] `[WireGuard <id>]` 段的 `dns-server`。它决定 Surge 把该策略当「通用代理」还是
   * 「点对点」,进而决定默认测速方式(无此项 → 原生 RTT 探测;有 → 标准 URL 测速)。
   * mihomo 侧近似物是 wireguard 的 `dns`,当前不输出。
   */
  wg_dns_server: z.array(z.string()).optional(),
  /** [S] `[WireGuard <id>]` 段的 `prefer-ipv6`,双栈时优先 IPv6 */
  wg_prefer_ipv6: z.boolean().optional(),

  // [CS] snell —— 两端都支持:mihomo v1–v5,Surge v1–v6(v6 为 Surge 独占,Clash 端跳过 + warning)
  psk: z.string().optional(),
  snell_version: z
    .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])
    .optional(),

  // [CS] 连接复用开关(snell v4+ / anytls;anytls 规范默认开启,false 显式关闭)
  reuse: z.boolean().optional(),

  // [CS] Shadow TLS 传输层混淆(可叠加在任意 TCP 协议上;机场常配 snell/ss 使用)
  // clash(mihomo)按协议分三套写法,见 generators/protocol-mapping.ts 的 SHADOW_TLS_FIELDS
  // surge: 任意 proxy 行追加 `shadow-tls-password= / shadow-tls-sni= / shadow-tls-version=`(仅 2/3)
  shadow_tls_password: z.string().optional(),
  shadow_tls_sni: z.string().optional(),
  shadow_tls_version: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),

  // [S] shadowsocks plugin
  plugin: z.string().optional(),
  plugin_opts: z.record(z.unknown()).optional(),
  obfs_host: z.string().optional(),
  obfs_uri: z.string().optional(),

  // [CS] socks5/http auth
  username: z.string().optional(),

  // [CS] chain proxy
  chain_via: namedRefSchema.optional(), // clash:`dialer-proxy`, surge:`underlying-proxy`

  // metadata (not exported to client config)
  source_provider_id: z.string().optional(),
  region: regionCodeSchema.optional(),
  level: z.string().optional(),
  line: z.string().optional(),
  tags: tagsSchema,
});

export type Node = z.infer<typeof nodeSchema>;
