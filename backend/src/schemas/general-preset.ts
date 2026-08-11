import { z } from "zod";
import { idSchema } from "./common.js";

const dnsSchema = z
  .object({
    enable: z.boolean().default(true),
    listen: z.string().optional(), // [C]
    ipv6: z.boolean().optional(),
    enhanced_mode: z.enum(["fake-ip", "redir-host"]).optional(), // [C]
    fake_ip_range: z.string().optional(), // [C]
    fake_ip_filter: z.array(z.string()).default([]).optional(), // [C]
    nameserver: z.array(z.string()).default([]).optional(), // [C]
    fallback: z.array(z.string()).default([]).optional(), // [C]
    nameserver_policy: z.record(z.string()).optional(), // [C]
    proxy_server_nameserver: z.array(z.string()).default([]).optional(), // [C] 节点域名解析兜底;host 的 server: 派生的 proxy-server-nameserver-policy 生效前提

    // [S]
    server: z.array(z.string()).optional(), // surge dns-server
    encrypted_server: z.array(z.string()).optional(), // surge encrypted-dns-server
    hijack: z.array(z.string()).optional(), // surge hijack-dns
  })
  .optional();

const tunSchema = z
  .object({
    enable: z.boolean().default(false),
    stack: z.enum(["system", "gvisor", "mixed"]).default("system"),
    auto_route: z.boolean().default(true),
    auto_detect_interface: z.boolean().default(true),
    dns_hijack: z.array(z.string()).default(["any:53"]),
    mtu: z.number().int().optional(),
  })
  .optional();

const snifferSchema = z
  .object({
    enable: z.boolean().default(false),
    sniff: z
      .object({
        TLS: z.object({ ports: z.array(z.union([z.number(), z.string()])).optional() }).optional(),
        HTTP: z.object({ ports: z.array(z.union([z.number(), z.string()])).optional() }).optional(),
      })
      .optional(),
  })
  .optional();

const mitmSchema = z
  .object({
    enable: z.boolean().default(false),
    hostname: z.array(z.string()).default([]),
    h2: z.boolean().default(true),
    tcp_connection: z.boolean().default(false),
    skip_server_cert_verify: z.boolean().default(false),
    ca_p12: z.string().optional(), // base64-encoded PKCS#12
    ca_passphrase: z.string().optional(),
  })
  .optional();

// Surge `http-api = key@ip:port`(https://manual.nssurge.com/profile/general.html):
// key 是一整串不可再切分的密钥,协议里没有用户名概念,所以只存 password。
const httpApiSchema = z
  .preprocess(
    // 存量 yaml 可能带早期版本落下的 `user`(当年按 `:` 拆出来的)。直接丢掉会让写回的
    // key 从 `user:pw` 变成 `pw`,Surge 侧 X-Key 失配,所以折回 password 前缀。
    (v) => {
      if (typeof v !== "object" || v === null) return v;
      const { user, ...rest } = v as Record<string, unknown>;
      if (typeof user !== "string" || user === "") return rest;
      const password = typeof rest.password === "string" ? rest.password : "";
      return { ...rest, password: `${user}:${password}` };
    },
    z.object({
      // 空串会产出畸形的 `http-api = @0.0.0.0:8890`,Surge 加载时直接报错,所以必须非空。
      password: z.string().min(1, "HTTP API 密钥不能为空"),
      listen: z.string().default("0.0.0.0:8890"),
      // 与 Surge 手册的默认值对齐(默认 false)。网页控制台会挂在 http-api 的 listener 上,
      // 而 listen 默认是 0.0.0.0,默认开启等于把控制台暴露到整个局域网。
      web_dashboard: z.boolean().default(false),
      tls: z.boolean().default(false),
    }),
  )
  .optional();

// Surge [MTProto] 段:Surge 作为 Telegram MTProto 入站代理服务器(iOS 5.21.0+ / Mac 6.8.0+)。
// 一个 profile 只允许一个 [MTProto] 段;secret 为 32 位十六进制(可带 dd 前缀),
// 参考 https://manual.nssurge.com/others/mtproto.html
const mtprotoSchema = z
  .object({
    enable: z.boolean().default(false),
    interface: z.string().default("127.0.0.1"),
    port: z.number().int().min(1).max(65535).default(5753),
    secret: z.string().default(""),
    ipv6: z.boolean().optional(),
    dc_config_url: z.string().url().optional(),
  })
  .optional();

/**
 * Surge Subnet Settings —— "在匹配的网络下套用一组设置"。段名为兼容历史仍叫 `[SSID Setting]`,
 * 官方文档已改称 Subnet Settings(https://manual.nssurge.com/features/subnet-settings.html)。
 *
 * 与 `[Proxy Group]` 里的 subnet 组是**两个特性**:这里只改设置(挂起 / DNS / TFO 等),
 * "按网络选策略"要用 subnet 组或 `SUBNET` 规则。历史上本 schema 有个 `policy` 字段并会输出
 * `policy=`,但该参数在手册里从来不属于本段,Surge 也不认 —— preprocess 直接丢弃。
 *
 * `match` 存**完整的 subnet 表达式**(`SSID:` / `BSSID:` / `ROUTER:` / `TYPE:` / `MCCMNC:`;
 * 无前缀的裸值是 legacy 写法,按 SSID / BSSID / 网关 IP 依次比对)。带前缀的形式需
 * iOS 4.12.0+ / Mac 4.5.0+。表达式语法的权威页面是
 * https://manual.nssurge.com/rules/protocol-and-network.html 的 Subnet Expressions 小节。
 *
 * 刻意不校验非空:存量 yaml 里可能留着老 UI 点了"添加"却没填的空行,让整份 general 文件
 * 加载失败远比生成时报一条 warning 糟糕。空 match 由 generator 跳过 + warning。
 */
const ssidRuleSchema = z.preprocess(
  (v) => {
    if (typeof v !== "object" || v === null) return v;
    const { ssid, policy: _dropped, ...rest } = v as Record<string, unknown>;
    if (typeof rest.match === "string" || typeof ssid !== "string") return rest;
    return { ...rest, match: ssid.trim() === "" ? "" : `SSID:${ssid}` };
  },
  z.object({
    match: z.string(),
    suspend: z.boolean().optional(),
    /** [S] iOS 独占:覆盖该网络下的 Wi-Fi 助理 / 混合网络行为 */
    cellular_fallback: z.enum(["default", "off", "wifi-assist", "hybrid"]).optional(),
    /** [S] Mac 独占:把该网络当计费网络,自动开启 Metered Network Mode */
    cellular_mode: z.boolean().optional(),
    /** [S] iOS 4.12.0+ / Mac 4.5.0+ */
    tfo_behaviour: z.enum(["auto", "force-enabled", "force-disabled"]).optional(),
    /** [S] 该网络下的 DNS 上游,元素为 IP 或 `system` */
    dns_server: z.array(z.string()).optional(),
    /** [S] 该网络下的加密 DNS,元素为 DoH/DoQ URL 或 `off`(全局配了加密 DNS 时必须显式 off 才回退传统 DNS) */
    encrypted_dns_server: z.array(z.string()).optional(),
  }),
);

export const generalPresetSchema = z.object({
  id: idSchema,
  name: z.string().min(1),

  // [CS]
  port: z.number().int().min(1).max(65535).optional(),
  socks_port: z.number().int().min(1).max(65535).optional(),
  mixed_port: z.number().int().min(1).max(65535).optional(),
  allow_lan: z.boolean().default(false),
  mode: z.enum(["rule", "global", "direct"]).default("rule"),
  log_level: z.enum(["silent", "warning", "notify", "info", "debug", "verbose"]).default("info"),
  ipv6: z.boolean().default(false),

  // [S]
  http_listen: z.string().optional(),
  socks5_listen: z.string().optional(),
  read_etc_hosts: z.boolean().optional(),
  wifi_assist: z.boolean().optional(),
  allow_hotspot_access: z.boolean().optional(),
  allow_wifi_access: z.boolean().optional(),
  internet_test_url: z.string().url().optional(),
  proxy_test_url: z.string().url().optional(),
  test_timeout: z.number().int().optional(),
  proxy_test_udp: z.string().optional(),
  udp_policy_not_supported_behaviour: z.enum(["DIRECT", "REJECT"]).optional(),
  geoip_maxmind_url: z.string().url().optional(),
  ipv6_vif: z.enum(["off", "auto"]).optional(),
  skip_proxy: z.array(z.string()).optional(),
  exclude_simple_hostnames: z.boolean().optional(),
  always_real_ip: z.array(z.string()).optional(),
  show_error_page_for_reject: z.boolean().optional(),
  // [S] 全局 QUIC 拦截策略(iOS 5.14.6+ / Mac 5.10.3+):
  // per-policy(默认,按各 policy 自身设置) / all-proxy(拦截所有代理) / all(连 DIRECT 一起拦) / always-allow
  block_quic: z.enum(["per-policy", "all-proxy", "all", "always-allow"]).optional(),
  http_api: httpApiSchema,

  // [C]
  find_process_mode: z.enum(["strict", "always", "off"]).optional(),
  external_controller: z.string().optional(),
  external_ui: z.string().optional(),
  secret: z.string().optional(),
  global_client_fingerprint: z.string().optional(),
  geodata_mode: z.boolean().optional(),
  geo_auto_update: z.boolean().optional(),
  geo_update_interval: z.number().int().optional(),

  // [CS] both
  hosts: z.record(z.union([z.string(), z.array(z.string())])).optional(),

  // [S] Subnet Settings,产物里的段名是 `[SSID Setting]`
  ssid_rules: z.array(ssidRuleSchema).optional(),

  // nested
  dns: dnsSchema,
  tun: tunSchema, // [C]
  sniffer: snifferSchema, // [C]
  mitm: mitmSchema, // [S]
  mtproto: mtprotoSchema, // [S] Telegram MTProto 入站代理
});

export type GeneralPreset = z.infer<typeof generalPresetSchema>;
