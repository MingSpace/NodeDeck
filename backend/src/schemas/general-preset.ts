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

const httpApiSchema = z
  .object({
    user: z.string().default("M1ing"),
    password: z.string(),
    listen: z.string().default("0.0.0.0:8890"),
    web_dashboard: z.boolean().default(true),
    tls: z.boolean().default(false),
  })
  .optional();

const ssidRuleSchema = z.object({
  ssid: z.string(),
  suspend: z.boolean().optional(),
  policy: z.string().optional(),
});

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

  // [S]
  ssid_rules: z.array(ssidRuleSchema).optional(),

  // nested
  dns: dnsSchema,
  tun: tunSchema, // [C]
  sniffer: snifferSchema, // [C]
  mitm: mitmSchema, // [S]
});

export type GeneralPreset = z.infer<typeof generalPresetSchema>;
