import { describe, expect, it } from "vitest";
import { generateSurgeConfig } from "../../src/generators/surge.js";
import type { Profile } from "../../src/schemas/profile.js";
import type { Node } from "../../src/schemas/node.js";
import type { ProxyGroup } from "../../src/schemas/proxy-group.js";
import type { RuleSet } from "../../src/schemas/ruleset.js";
import type { GeneralPreset } from "../../src/schemas/general-preset.js";

function baseProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: "home",
    name: "Home",
    token: "abcdefghij12",
    providers: [],
    include_manual_nodes: true,
    node_filter: { rename_rules: [], exclude_types: [] },
    chain_rules: [],
    proxy_groups: [],
    rule_modules: [],
    surge_modules: [],
    userinfo: { mode: "sum", expose_per_provider_headers: true },
    managed_config_url: "auto",
    managed_config_interval: 86400,
    managed_config_strict: false,
    clash_options: { use_proxy_providers: false, flag: "mihomo", group_style: "flow" },
    ...overrides,
  };
}

describe("generateSurgeConfig", () => {
  it("emits #!MANAGED-CONFIG, [General], [Proxy], [Proxy Group], [Rule], [MITM]", () => {
    const general: GeneralPreset = {
      id: "home",
      name: "home",
      allow_lan: false,
      mode: "rule",
      log_level: "notify",
      ipv6: false,
      proxy_test_url: "http://cp.cloudflare.com/generate_204",
      test_timeout: 5,
      mitm: {
        enable: true,
        hostname: ["*.google.cn"],
        h2: true,
        tcp_connection: true,
        skip_server_cert_verify: true,
        ca_p12: "BASE64==",
        ca_passphrase: "MINGCA",
      },
    };
    const nodes: Node[] = [
      {
        name: "🇭🇰 HK-01",
        type: "trojan",
        server: "gz.example.com",
        port: 12101,
        password: "secret",
        sni: "m.ctrip.com",
        skip_cert_verify: true,
        udp: true,
        tls: true,
        tags: [],
      },
      {
        name: "🇭🇰 HK-SS",
        type: "ss",
        server: "ss.example.com",
        port: 8388,
        cipher: "2022-blake3-aes-128-gcm",
        password: "pwd,with,commas",
        udp: true,
        tags: [],
      },
    ];
    const groups: ProxyGroup[] = [
      {
        id: "Proxys",
        name: "Proxys",
        type: "url-test",
        proxies: ["🇭🇰 HK-01", "🇭🇰 HK-SS"],
        selector: { include_other_group: [], from_providers: [], exclude_type: [] },
        url: "http://cp.cloudflare.com",
        interval: 600,
        tolerance: 10,
      },
    ];
    const rules = [
      {
        ref: "cn",
        policy: "DIRECT",
        ruleset: {
          id: "cn",
          name: "CN",
          type: "remote_url",
          url: "https://example.com/cn.list",
          behavior: "classical",
          format: "yaml",
          surge_flags: { no_resolve: true },
          clash_format: "rule_provider",
          surge_format: "rule_set",
          update_interval: 86400,
        } satisfies RuleSet,
      },
      {
        ref: "ad",
        policy: "REJECT",
        ruleset: {
          id: "ad",
          name: "Ad",
          type: "remote_url",
          url: "https://example.com/ad.list",
          behavior: "domain",
          format: "yaml",
          surge_reject_options: {
            type: "REJECT-DROP",
            notification_text: "blocked by mconvert",
            notification_interval: 60,
          },
          surge_flags: { extended_matching: true, pre_matching: true, no_resolve: true },
          clash_format: "rule_provider",
          surge_format: "rule_set",
          update_interval: 86400,
        } satisfies RuleSet,
      },
    ];
    const out = generateSurgeConfig({
      profile: baseProfile({ proxy_groups: ["Proxys"] }),
      nodes,
      groups,
      rules,
      finalRule: { policy: "Proxys", dns_failed: true },
      geoipFallback: { policy: "DIRECT" },
      general,
      surgeModules: [],
      managed_config_url: "https://sub.example.com/sub?profile=home&target=surge&t=ABCD",
      warnings: [],
    });

    expect(out).toMatch(
      /^#!MANAGED-CONFIG https:\/\/sub.example.com\/sub\?profile=home&target=surge&t=ABCD interval=86400 strict=false/m,
    );
    expect(out).toContain("[General]");
    expect(out).toContain("loglevel = notify");
    expect(out).toContain("proxy-test-url = http://cp.cloudflare.com/generate_204");

    expect(out).toContain("[Proxy]");
    expect(out).toContain("DIRECT = direct");
    expect(out).toContain(
      "🇭🇰 HK-01 = trojan, gz.example.com, 12101, password=secret, sni=m.ctrip.com, skip-cert-verify=true, udp-relay=true",
    );
    // ss password has commas → must be quoted
    expect(out).toContain('password="pwd,with,commas"');
    expect(out).toContain("encrypt-method=2022-blake3-aes-128-gcm");

    expect(out).toContain("[Proxy Group]");
    expect(out).toContain("Proxys = url-test,🇭🇰 HK-01,🇭🇰 HK-SS,url=http://cp.cloudflare.com,interval=600,tolerance=10");

    expect(out).toContain("[Rule]");
    expect(out).toContain("RULE-SET,https://example.com/cn.list,DIRECT,no-resolve");
    expect(out).toContain(
      `RULE-SET,https://example.com/ad.list,REJECT-DROP,'notification-text="blocked by mconvert"','notification-interval=60',no-resolve,extended-matching,pre-matching`,
    );
    expect(out).toContain("GEOIP,CN,DIRECT,no-resolve");
    expect(out).toContain("FINAL,Proxys,dns-failed");

    expect(out).toContain("[MITM]");
    expect(out).toContain("enable = true");
    expect(out).toContain("hostname = *.google.cn");
    expect(out).toContain("ca-passphrase = MINGCA");
    expect(out).toContain("ca-p12 = BASE64==");
  });

  it("translates chain_via to underlying-proxy", () => {
    const nodes: Node[] = [
      { name: "WARP", type: "wireguard", server: "wg.com", port: 2408, private_key: "PK", public_key: "PUB", ip: "10.0.0.2/32", tags: [] },
      { name: "HK-01", type: "trojan", server: "g.com", port: 443, password: "x", sni: "x.com", chain_via: "WARP", tls: true, tags: [] },
    ];
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes,
      groups: [],
      rules: [],
      surgeModules: [],
      warnings: [],
    });
    expect(out).toContain("HK-01 = trojan, g.com, 443");
    expect(out).toContain("underlying-proxy=WARP");
  });

  it("emits inline_ruleset section", () => {
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes: [],
      groups: [],
      rules: [
        {
          ref: "stream",
          policy: "Proxys",
          ruleset: {
            id: "stream",
            name: "Stream",
            type: "inline_list",
            payload: ["DOMAIN-SUFFIX,netflix.com", "DOMAIN-SUFFIX,nflxvideo.net"],
            behavior: "domain",
            format: "yaml",
            clash_format: "inline",
            surge_format: "inline_ruleset",
            update_interval: 86400,
          } satisfies RuleSet,
        },
      ],
      surgeModules: [],
      warnings: [],
    });
    expect(out).toContain("RULE-SET,stream,Proxys");
    expect(out).toContain("[Ruleset stream]");
    expect(out).toContain("DOMAIN-SUFFIX,netflix.com");
    expect(out).toContain("DOMAIN-SUFFIX,nflxvideo.net");
  });

  it("merges surge module sections", () => {
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes: [],
      groups: [],
      rules: [],
      surgeModules: [
        {
          id: "google-cn",
          name: "google-cn",
          enabled_by_default: true,
          content_sections: {
            url_rewrite: "^https?://(www.)?(g|google)\\.?(cn|com.hk) https://www.google.com 302",
            mitm: "hostname = %APPEND% *.google.cn",
          },
        },
      ],
      warnings: [],
    });
    expect(out).toContain("[URL Rewrite]");
    expect(out).toContain("^https?://(www.)?(g|google)\\.?(cn|com.hk) https://www.google.com 302");
    expect(out).toContain("[MITM]");
    expect(out).toContain("hostname = %APPEND% *.google.cn");
  });
});
