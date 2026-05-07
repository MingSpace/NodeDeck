import type { Profile } from "../../../src/schemas/profile.js";
import type { Node } from "../../../src/schemas/node.js";
import type { ProxyGroup } from "../../../src/schemas/proxy-group.js";
import type { RuleSet } from "../../../src/schemas/ruleset.js";
import type { GeneralPreset } from "../../../src/schemas/general-preset.js";

export const profile: Profile = {
  id: "example",
  name: "Example",
  token: "fixturetoken",
  providers: [],
  include_manual_nodes: true,
  node_filter: { rename_rules: [], exclude_types: [] },
  chain_rules: [],
  proxy_groups: ["Proxys", "Manual"],
  rule_modules: [
    { ref: "cn-direct", policy: "DIRECT", enabled: true },
    { ref: "reject-list", policy: "REJECT" },
    { final: "Manual" },
  ],
  surge_modules: [],
  general_preset: "home",
  userinfo: { enabled: false, mode: "sum", expose_per_provider_headers: true },
  managed_config_url: "auto",
  managed_config_interval: 86400,
  managed_config_strict: false,
  clash_options: { use_proxy_providers: false, flag: "mihomo", group_style: "flow" },
};

export const nodes: Node[] = [
  {
    name: "🇭🇰 HK-01",
    type: "trojan",
    server: "hk.example.com",
    port: 443,
    password: "secret",
    sni: "hk.test",
    skip_cert_verify: true,
    udp: true,
    tls: true,
    tags: [],
  },
  {
    name: "🇯🇵 JP-01",
    type: "ss",
    server: "jp.example.com",
    port: 8388,
    cipher: "aes-128-gcm",
    password: "pwd",
    udp: true,
    tags: [],
  },
];

export const groups: ProxyGroup[] = [
  {
    id: "Proxys",
    name: "Proxys",
    type: "url-test",
    proxies: ["🇭🇰 HK-01", "🇯🇵 JP-01"],
    url: "http://cp.cloudflare.com/generate_204",
    interval: 600,
    tolerance: 50,
    timeout: 5,
  },
  {
    id: "Manual",
    name: "Manual",
    type: "select",
    proxies: ["Proxys", "DIRECT"],
  },
];

export const rules: { ref: string; policy: string; ruleset: RuleSet }[] = [
  {
    ref: "cn-direct",
    policy: "DIRECT",
    ruleset: {
      id: "cn-direct",
      name: "cn-direct",
      type: "remote_url",
      url: "https://example.com/cn.yaml",
      behavior: "domain",
      format: "yaml",
      clash_format: "rule_provider",
      surge_format: "rule_set",
      update_interval: 86400,
    },
  },
  {
    ref: "reject-list",
    policy: "REJECT",
    ruleset: {
      id: "reject-list",
      name: "reject-list",
      type: "remote_url",
      url: "https://example.com/reject.conf",
      behavior: "classical",
      format: "yaml",
      clash_format: "rule_provider",
      surge_format: "rule_set",
      update_interval: 86400,
    },
  },
];

export const finalRule = { policy: "Manual" };

export const general: GeneralPreset = {
  id: "home",
  name: "Home",
  mode: "rule",
  log_level: "notify",
  ipv6: false,
  allow_lan: false,
  proxy_test_url: "http://cp.cloudflare.com/generate_204",
  internet_test_url: "http://wifi.vivo.com.cn/generate_204",
  test_timeout: 5,
  skip_proxy: ["127.0.0.0/8", "192.168.0.0/16", "localhost"],
  exclude_simple_hostnames: true,
  dns: {
    enable: true,
    server: ["119.29.29.29", "223.5.5.5"],
    hijack: ["8.8.8.8:53"],
  },
};
