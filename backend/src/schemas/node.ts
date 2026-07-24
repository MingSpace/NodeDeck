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
  servername: z.string().optional(), // alias for sni in some clients

  // [CS] common knobs
  udp: z.boolean().optional(), // clash:`udp`, surge:`udp-relay`
  tfo: z.boolean().optional(),
  mptcp: z.boolean().optional(),

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
  mtu: z.number().int().min(576).max(9000).optional(),
  peers: z.array(wgPeerSchema).optional(), // [C] only

  // [S] snell
  psk: z.string().optional(),
  snell_version: z.union([z.literal(3), z.literal(4), z.literal(5), z.literal(6)]).optional(),

  // [S] 连接复用开关(snell v4+ / anytls;anytls 规范默认开启,false 显式关闭)
  reuse: z.boolean().optional(),

  // [CS] Shadow TLS 传输层混淆(可叠加在任意 TCP 协议上;机场常配 snell/ss 使用)
  // clash(mihomo): 仅 ss 支持,`plugin: shadow-tls` + plugin-opts { password, host, version }
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
