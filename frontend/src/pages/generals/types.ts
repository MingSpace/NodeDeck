export interface GeneralPresetData {
  id: string;
  name: string;
  port?: number;
  socks_port?: number;
  mixed_port?: number;
  allow_lan: boolean;
  mode: "rule" | "global" | "direct";
  log_level: "silent" | "warning" | "notify" | "info" | "debug" | "verbose";
  ipv6: boolean;
  http_listen?: string;
  socks5_listen?: string;
  read_etc_hosts?: boolean;
  wifi_assist?: boolean;
  allow_hotspot_access?: boolean;
  allow_wifi_access?: boolean;
  internet_test_url?: string;
  proxy_test_url?: string;
  test_timeout?: number;
  proxy_test_udp?: string;
  udp_policy_not_supported_behaviour?: "DIRECT" | "REJECT";
  geoip_maxmind_url?: string;
  ipv6_vif?: "off" | "auto";
  skip_proxy?: string[];
  exclude_simple_hostnames?: boolean;
  always_real_ip?: string[];
  show_error_page_for_reject?: boolean;
  block_quic?: "per-policy" | "all-proxy" | "all" | "always-allow";
  http_api?: {
    user: string;
    password: string;
    listen: string;
    web_dashboard: boolean;
    tls: boolean;
  };
  find_process_mode?: "strict" | "always" | "off";
  external_controller?: string;
  external_ui?: string;
  secret?: string;
  global_client_fingerprint?: string;
  hosts?: Record<string, string | string[]>;
  ssid_rules?: Array<{ ssid: string; suspend?: boolean; policy?: string }>;
  dns?: {
    enable: boolean;
    listen?: string;
    ipv6?: boolean;
    enhanced_mode?: "fake-ip" | "redir-host";
    fake_ip_range?: string;
    fake_ip_filter?: string[];
    nameserver?: string[];
    fallback?: string[];
    nameserver_policy?: Record<string, string>;
    proxy_server_nameserver?: string[];
    server?: string[];
    encrypted_server?: string[];
    hijack?: string[];
  };
  tun?: {
    enable: boolean;
    stack: "system" | "gvisor" | "mixed";
    auto_route: boolean;
    auto_detect_interface: boolean;
    dns_hijack: string[];
    mtu?: number;
  };
  sniffer?: {
    enable: boolean;
    sniff?: {
      TLS?: { ports?: Array<number | string> };
      HTTP?: { ports?: Array<number | string> };
    };
  };
  mitm?: {
    enable: boolean;
    hostname: string[];
    h2: boolean;
    tcp_connection: boolean;
    skip_server_cert_verify: boolean;
    ca_p12?: string;
    ca_passphrase?: string;
  };
  mtproto?: {
    enable: boolean;
    interface: string;
    port: number;
    secret: string;
    ipv6?: boolean;
    dc_config_url?: string;
  };
}
