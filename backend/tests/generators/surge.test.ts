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
    node_filter: { rename_rules: [], exclude_types: [], sort_by_region: false },
    chain_rules: [],
    proxy_groups: [],
    rule_modules: [],
    surge_modules: [],
    userinfo: { enabled: false, mode: "sum", expose_per_provider_headers: true },
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
        nested_groups: [],
        selector: { from_providers: [], exclude_type: [], include_region: [] },
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
            notification_text: "blocked by nodedeck",
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
      `RULE-SET,https://example.com/ad.list,REJECT-DROP,'notification-text="blocked by nodedeck"','notification-interval=60',no-resolve,extended-matching,pre-matching`,
    );
    expect(out).toContain("GEOIP,CN,DIRECT,no-resolve");
    expect(out).toContain("FINAL,Proxys,dns-failed");

    expect(out).toContain("[MITM]");
    expect(out).toContain("enable = true");
    expect(out).toContain("hostname = *.google.cn");
    expect(out).toContain("ca-passphrase = MINGCA");
    expect(out).toContain("ca-p12 = BASE64==");
  });

  it("removes dangling node refs from group.proxies after node_filter and emits warning", () => {
    const nodes: Node[] = [
      { name: "HK-01", type: "trojan", server: "g.com", port: 443, password: "x", sni: "x.com", tls: true, tags: [] },
      { name: "JP-01", type: "ss", server: "j.com", port: 8388, cipher: "aes-128-gcm", password: "y", tags: [] },
      { name: "AD-01", type: "ss", server: "a.com", port: 8388, cipher: "aes-128-gcm", password: "z", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      {
        id: "Proxys",
        name: "Proxys",
        type: "select",
        proxies: ["HK-01", "JP-01", "AD-01", "Manual", "DIRECT", "REJECT-DROP"],
      },
      {
        id: "Manual",
        name: "Manual",
        type: "select",
        proxies: ["Proxys", "DIRECT"],
      },
    ];
    const warnings: string[] = [];
    const out = generateSurgeConfig({
      profile: baseProfile({
        proxy_groups: ["Proxys", "Manual"],
        node_filter: { rename_rules: [], exclude_types: [], sort_by_region: false, exclude_regex: "^AD-" },
      }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "Manual" },
      surgeModules: [],
      warnings,
    });
    // 行格式: <name> = select,m1,m2,...
    const proxysLine = out.split(/\r?\n/).find((l) => l.startsWith("Proxys = "))!;
    expect(proxysLine).toBeDefined();
    expect(proxysLine).not.toContain("AD-01");
    expect(proxysLine).toContain("HK-01");
    expect(proxysLine).toContain("JP-01");
    expect(proxysLine).toContain("Manual");
    expect(proxysLine).toContain("DIRECT");
    expect(proxysLine).toContain("REJECT-DROP");
    expect(warnings.some((w) => w.includes("Proxys") && w.includes("AD-01") && w.includes("移除了 1 个"))).toBe(true);
  });

  it("filters group members by selector.include_region (whitelist)", () => {
    // include_region 白名单:只保留 node.region 命中的节点;region 未识别(undefined)的节点也排除。
    // 与 clash 端等价测试同步,确保两端行为一致。
    const nodes: Node[] = [
      { name: "JP-01", type: "ss", server: "j.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "JP", tags: [] },
      { name: "HK-01", type: "ss", server: "h.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "HK", tags: [] },
      { name: "US-01", type: "ss", server: "u.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "US", tags: [] },
      { name: "Unknown-01", type: "ss", server: "z.com", port: 8388, cipher: "aes-128-gcm", password: "x", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      {
        id: "AsiaOnly",
        name: "AsiaOnly",
        type: "select",
        proxies: [],
        nested_groups: [],
        selector: {
          from_providers: [],
          exclude_type: [],
          include_region: ["JP", "HK"],
        },
      },
    ];
    const out = generateSurgeConfig({
      profile: baseProfile({ proxy_groups: ["AsiaOnly"] }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "AsiaOnly" },
      surgeModules: [],
      warnings: [],
    });
    const asiaLine = out.split(/\r?\n/).find((l) => l.startsWith("AsiaOnly = "))!;
    expect(asiaLine).toBeDefined();
    expect(asiaLine).toContain("JP-01");
    expect(asiaLine).toContain("HK-01");
    expect(asiaLine).not.toContain("US-01");
    expect(asiaLine).not.toContain("Unknown-01");
  });

  it("hidden_nodes: 节点留在 [Proxy] 且能当 underlying-proxy,但不进组的 selector 成员", () => {
    const nodes: Node[] = [
      { name: "HK 中转-01", type: "ss", server: "h.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "HK", tags: [] },
      { name: "JP 落地-01", type: "ss", server: "j.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "JP", chain_via: "HK 中转-01", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      {
        id: "Auto",
        name: "Auto",
        type: "url-test",
        proxies: [],
        nested_groups: [],
        selector: { from_providers: [], exclude_type: [], include_region: [] },
      },
      {
        id: "Landing",
        name: "Landing",
        type: "select",
        proxies: ["JP 落地-01"],
        nested_groups: [],
      },
    ];
    const out = generateSurgeConfig({
      profile: baseProfile({
        proxy_groups: ["Auto", "Landing"],
        hidden_nodes: {
          include_regex: "落地",
          from_providers: [],
          include_region: [],
          include_type: [],
          exclude_type: [],
          include_nodes: [],
        },
      }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "Auto" },
      surgeModules: [],
      warnings: [],
    });
    const lines = out.split(/\r?\n/);
    // [Proxy] 段仍有这个节点,且链式参数完好
    const proxyLine = lines.find((l) => l.startsWith("JP 落地-01 = "))!;
    expect(proxyLine).toContain("underlying-proxy=HK 中转-01");
    // selector 动态匹配的组不再收纳隐藏节点
    expect(lines.find((l) => l.startsWith("Auto = "))!).not.toContain("JP 落地-01");
    // 显式点名保留
    expect(lines.find((l) => l.startsWith("Landing = "))!).toContain("JP 落地-01");
  });

  it("nested_groups: 把其它组作为嵌套引用加进 [Proxy Group] 行的成员段", () => {
    // 跟 clash 的同名测试对称 — 验证 v2 nested_groups 字段在 surge 端的契约。
    // Surge 客户端把每个组成员段(逗号分隔)里的"组名"识别成嵌套引用,
    // 用户在 Stream 里选 Japan 会跳到 Japan 组的选择器。
    const nodes: Node[] = [
      { name: "JP-01", type: "ss", server: "j.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "JP", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      {
        id: "Japan",
        name: "Japan",
        type: "url-test",
        proxies: ["JP-01"],
        nested_groups: [],
        url: "http://cp.cloudflare.com",
        interval: 300,
      },
      {
        id: "Stream",
        name: "Stream",
        type: "select",
        proxies: ["DIRECT"],
        nested_groups: ["Japan"],
      },
    ];
    const out = generateSurgeConfig({
      profile: baseProfile({ proxy_groups: ["Japan", "Stream"] }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "Stream" },
      surgeModules: [],
      warnings: [],
    });
    const streamLine = out.split(/\r?\n/).find((l) => l.startsWith("Stream = "))!;
    expect(streamLine).toBeDefined();
    expect(streamLine).toContain("Japan"); // 嵌套引用作为同级 proxy 项
    expect(streamLine).toContain("DIRECT"); // 独立 builtin
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

  it("emits Surge internal ruleset (SYSTEM/LAN) as RULE-SET,<name>,POLICY", () => {
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes: [],
      groups: [],
      rules: [
        {
          ref: "sys",
          policy: "DIRECT",
          ruleset: {
            id: "imported-rule-system-abc123",
            name: "SYSTEM",
            type: "surge_internal",
            surge_internal_name: "SYSTEM",
            behavior: "classical",
            format: "text",
            clash_format: "rule_provider",
            surge_format: "rule_set",
            update_interval: 86400,
          } satisfies RuleSet,
        },
        {
          ref: "lan",
          policy: "DIRECT",
          ruleset: {
            id: "imported-rule-lan-def456",
            name: "LAN",
            type: "surge_internal",
            surge_internal_name: "LAN",
            behavior: "classical",
            format: "text",
            // 模拟用户带 no-resolve 的边界,确认 flags 也能透传
            surge_flags: { no_resolve: true },
            clash_format: "rule_provider",
            surge_format: "rule_set",
            update_interval: 86400,
          } satisfies RuleSet,
        },
      ],
      surgeModules: [],
      warnings: [],
    });
    expect(out).toContain("RULE-SET,SYSTEM,DIRECT");
    expect(out).toContain("RULE-SET,LAN,DIRECT,no-resolve");
    // 不应该把 surge_internal 当成 remote_url 写出 URL
    expect(out).not.toContain("SYSTEM,DIRECT,");
    expect(out).not.toMatch(/RULE-SET,LAN,DIRECT\s*$/m); // 末尾必须带 no-resolve
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
