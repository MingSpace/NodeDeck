import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { generateClashConfig } from "../../src/generators/clash.js";
import type { Profile } from "../../src/schemas/profile.js";
import type { Node } from "../../src/schemas/node.js";
import type { ProxyGroup } from "../../src/schemas/proxy-group.js";
import type { RuleSet } from "../../src/schemas/ruleset.js";
import { generalPresetSchema } from "../../src/schemas/general-preset.js";
import { providerSchema } from "../../src/schemas/provider.js";

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

describe("generateClashConfig", () => {
  it("emits proxies, proxy-groups, rules with rule-providers", () => {
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
        name: "🇯🇵 JP-01",
        type: "ss",
        server: "jp.example.com",
        port: 8388,
        cipher: "2022-blake3-aes-128-gcm",
        password: "pwd",
        udp: true,
        tags: [],
      },
    ];
    const groups: ProxyGroup[] = [
      {
        id: "Proxys",
        name: "Proxys",
        type: "url-test",
        proxies: [],
        nested_groups: [],
        selector: { from_providers: [], exclude_type: [], include_region: [] },
        url: "http://cp.cloudflare.com",
        interval: 600,
      },
    ];
    const rules = [
      {
        ref: "cn-direct",
        policy: "DIRECT",
        ruleset: {
          id: "cn-direct",
          name: "CN Direct",
          type: "remote_url",
          url: "https://example.com/cn.list",
          behavior: "domain",
          format: "yaml",
          clash_format: "rule_provider",
          surge_format: "rule_set",
          update_interval: 86400,
        } satisfies RuleSet,
      },
    ];
    const out = generateClashConfig({
      profile: baseProfile({ proxy_groups: ["Proxys"] }),
      nodes,
      groups,
      rules,
      finalRule: { policy: "Proxys" },
      geoipFallback: { policy: "DIRECT" },
      warnings: [],
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    expect(parsed.proxies).toHaveLength(2);
    expect(parsed["rule-providers"]).toMatchObject({
      "cn-direct": { type: "http", behavior: "domain", url: "https://example.com/cn.list" },
    });
    expect((parsed.rules as string[])).toEqual([
      "RULE-SET,cn-direct,DIRECT",
      "GEOIP,CN,DIRECT,no-resolve",
      "MATCH,Proxys",
    ]);
    const proxies = parsed.proxies as Record<string, unknown>[];
    expect(proxies[0]).toMatchObject({
      name: "🇭🇰 HK-01",
      type: "trojan",
      "skip-cert-verify": true,
      udp: true,
    });
    expect(proxies[1]).toMatchObject({
      type: "ss",
      cipher: "2022-blake3-aes-128-gcm",
    });
  });

  it("handles Surge internal ruleset: LAN expanded inline, SYSTEM skipped with warning", () => {
    const warnings: string[] = [];
    const out = generateClashConfig({
      profile: baseProfile(),
      nodes: [],
      groups: [],
      rules: [
        {
          ref: "sys",
          policy: "DIRECT",
          ruleset: {
            id: "imported-rule-system",
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
            id: "imported-rule-lan",
            name: "LAN",
            type: "surge_internal",
            surge_internal_name: "LAN",
            behavior: "classical",
            format: "text",
            clash_format: "rule_provider",
            surge_format: "rule_set",
            update_interval: 86400,
          } satisfies RuleSet,
        },
      ],
      finalRule: { policy: "DIRECT" },
      warnings,
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    const rules = parsed.rules as string[];
    // LAN 应被展开为内联规则
    expect(rules).toContain("DOMAIN-SUFFIX,local,DIRECT");
    expect(rules).toContain("IP-CIDR,192.168.0.0/16,DIRECT");
    expect(rules).toContain("IP-CIDR6,fe80::/10,DIRECT");
    // SYSTEM 不应出现在 rules 中
    expect(rules.some((r) => r.includes("SYSTEM"))).toBe(false);
    // warning 必须提示 SYSTEM 被跳过
    expect(out).toMatch(/# WARN:.*SYSTEM/);
  });

  it("removes dangling node refs from group.proxies after node_filter and emits warning", () => {
    const nodes: Node[] = [
      { name: "🇭🇰 HK-01", type: "trojan", server: "g.com", port: 443, password: "x", sni: "x.com", tls: true, tags: [] },
      { name: "🇯🇵 JP-01", type: "ss", server: "j.com", port: 8388, cipher: "aes-128-gcm", password: "y", tags: [] },
      { name: "广告测试-1", type: "ss", server: "a.com", port: 8388, cipher: "aes-128-gcm", password: "z", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      {
        id: "Proxys",
        name: "Proxys",
        type: "select",
        proxies: ["🇭🇰 HK-01", "🇯🇵 JP-01", "广告测试-1", "Manual", "DIRECT", "REJECT-DROP"],
        nested_groups: [],
      },
      {
        id: "Manual",
        name: "Manual",
        type: "select",
        proxies: ["Proxys", "DIRECT"],
        nested_groups: [],
      },
    ];
    const warnings: string[] = [];
    const out = generateClashConfig({
      profile: baseProfile({
        proxy_groups: ["Proxys", "Manual"],
        // 把"广告测试"开头的节点过滤掉
        node_filter: { rename_rules: [], exclude_types: [], sort_by_region: false, exclude_regex: "^广告测试" },
      }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "Manual" },
      warnings,
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    const proxyGroups = parsed["proxy-groups"] as Array<Record<string, unknown>>;
    const proxysGroup = proxyGroups.find((g) => g.name === "Proxys")!;
    const proxysMembers = proxysGroup.proxies as string[];
    // 被过滤掉的节点名应该不在 group.proxies 里
    expect(proxysMembers).not.toContain("广告测试-1");
    // 仍然存在的节点 / 组名 / 内置 policy 应保留
    expect(proxysMembers).toContain("🇭🇰 HK-01");
    expect(proxysMembers).toContain("🇯🇵 JP-01");
    expect(proxysMembers).toContain("Manual");
    expect(proxysMembers).toContain("DIRECT");
    expect(proxysMembers).toContain("REJECT-DROP");
    // 至少有一条 warning 提到 Proxys 组的悬空引用(per-group 截断格式)
    expect(warnings.some((w) => w.includes("Proxys") && w.includes("广告测试-1") && w.includes("移除了 1 个"))).toBe(true);
  });

  it("filters group members by selector.include_region (whitelist)", () => {
    // include_region 是白名单:只保留 node.region 命中的节点;region 未识别(undefined)的节点也排除。
    // 与 from_providers / exclude_type 同 pipeline,这里专门验证 region 过滤在 group members 解析时生效。
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
    const out = generateClashConfig({
      profile: baseProfile({ proxy_groups: ["AsiaOnly"] }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "AsiaOnly" },
      warnings: [],
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    const proxyGroups = parsed["proxy-groups"] as Array<Record<string, unknown>>;
    const asiaGroup = proxyGroups.find((g) => g.name === "AsiaOnly")!;
    const members = asiaGroup.proxies as string[];
    expect(members).toContain("JP-01");
    expect(members).toContain("HK-01");
    expect(members).not.toContain("US-01");
    expect(members).not.toContain("Unknown-01");
  });

  it("nested_groups: 把其它组作为嵌套 proxy 项加进 yaml proxies 数组", () => {
    // 这是 v2 nested_groups 字段的核心行为契约 — 客户端会把 "Japan" 当成另一个
    // proxy group 名,在 Stream → 选 Japan 时跳转到 Japan 组的子选择器。
    // 跟 selector(动态筛选独立节点)是不同维度,跟 g.proxies(放节点+builtin)也不同。
    const nodes: Node[] = [
      { name: "JP-01", type: "ss", server: "j.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "JP", tags: [] },
      { name: "JP-02", type: "ss", server: "j2.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "JP", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      {
        id: "Japan",
        name: "Japan",
        type: "url-test",
        proxies: [],
        nested_groups: [],
        selector: { from_providers: [], exclude_type: [], include_region: ["JP"] },
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
    const out = generateClashConfig({
      profile: baseProfile({ proxy_groups: ["Japan", "Stream"] }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "Stream" },
      warnings: [],
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    const proxyGroups = parsed["proxy-groups"] as Array<Record<string, unknown>>;
    const stream = proxyGroups.find((g) => g.name === "Stream")!;
    const members = stream.proxies as string[];
    expect(members).toContain("Japan"); // 嵌套引用作为同级 proxy 项
    expect(members).toContain("DIRECT"); // 独立的内置 policy
  });

  it("translates chain_via to dialer-proxy", () => {
    const nodes: Node[] = [
      {
        name: "WARP",
        type: "wireguard",
        server: "wg.example.com",
        port: 2408,
        private_key: "PRIV",
        public_key: "PUB",
        ip: "172.16.0.2/32",
        tags: [],
      },
      {
        name: "HK-01",
        type: "trojan",
        server: "gz.example.com",
        port: 443,
        password: "x",
        sni: "x.com",
        chain_via: "WARP",
        tls: true,
        tags: [],
      },
    ];
    const out = generateClashConfig({
      profile: baseProfile(),
      nodes,
      groups: [],
      rules: [],
      finalRule: { policy: "DIRECT" },
      warnings: [],
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    const proxies = parsed.proxies as Record<string, unknown>[];
    expect(proxies[1]["dialer-proxy"]).toBe("WARP");
  });

  it("hidden_nodes: 节点留在 proxies 且能当 dialer-proxy,但不进组的 selector 成员", () => {
    const nodes: Node[] = [
      { name: "HK 中转-01", type: "ss", server: "hk.example.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "HK", tags: [] },
      { name: "JP 落地-01", type: "ss", server: "jp.example.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "JP", chain_via: "HK 中转-01", tags: [] },
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
    const out = generateClashConfig({
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
      warnings: [],
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    const proxies = parsed.proxies as Record<string, unknown>[];
    // 仍然写进 proxies,否则 dialer-proxy / 显式点名都会悬空
    expect(proxies.map((p) => p.name)).toEqual(["HK 中转-01", "JP 落地-01"]);
    expect(proxies[1]["dialer-proxy"]).toBe("HK 中转-01");

    const proxyGroups = parsed["proxy-groups"] as Array<Record<string, unknown>>;
    // selector 动态匹配的组不再收纳隐藏节点
    expect(proxyGroups.find((g) => g.name === "Auto")!.proxies).toEqual(["HK 中转-01"]);
    // 显式点名保留 —— 用户就是靠这种组来使用链式落地的
    expect(proxyGroups.find((g) => g.name === "Landing")!.proxies).toEqual(["JP 落地-01"]);
  });

  it("hidden_nodes: proxy-providers 模式下会 warn 隐藏在客户端失效", () => {
    const warnings: string[] = [];
    const nodes: Node[] = [
      { name: "JP 落地-01", type: "ss", server: "jp.example.com", port: 8388, cipher: "aes-128-gcm", password: "x", source_provider_id: "air", tags: [] },
    ];
    generateClashConfig({
      profile: baseProfile({
        clash_options: { use_proxy_providers: true, flag: "mihomo", group_style: "flow" },
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
      groups: [],
      rules: [],
      finalRule: { policy: "DIRECT" },
      providers: [
        providerSchema.parse({
          id: "air",
          name: "Air",
          type: "http",
          url: "https://example.com/sub",
          clash_proxy_provider: { enabled: true },
        }),
      ],
      baseUrl: "https://nodedeck.example.com",
      profileToken: "abcdefghij12",
      warnings,
    });
    expect(warnings.some((w) => w.includes("use_proxy_providers") && w.includes("仍可被直接选择"))).toBe(true);
  });

  it("routes host server: to dns.proxy-server-nameserver-policy with fallback from general", () => {
    const warnings: string[] = [];
    const general = generalPresetSchema.parse({
      id: "g1",
      name: "G1",
      dns: { enable: true, proxy_server_nameserver: ["https://doh.pub/dns-query"] },
    });
    const out = generateClashConfig({
      profile: baseProfile(),
      nodes: [],
      groups: [],
      rules: [],
      finalRule: { policy: "DIRECT" },
      general,
      hosts: {
        "*.example.com": ["server:https://a/dns-query", "server:https://b/dns-query"],
      },
      warnings,
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    const dns = parsed.dns as Record<string, unknown>;
    expect(dns["proxy-server-nameserver"]).toEqual(["https://doh.pub/dns-query"]);
    expect(dns["proxy-server-nameserver-policy"]).toEqual({
      "+.example.com": ["https://a/dns-query", "https://b/dns-query"],
    });
    // server: 条目不进顶层 hosts:
    expect(parsed.hosts).toBeUndefined();
    expect(warnings.some((w) => w.includes("proxy-server-nameserver"))).toBe(false);
  });

  it("warns when proxy-server-nameserver fallback is empty (policy would not take effect)", () => {
    const warnings: string[] = [];
    const out = generateClashConfig({
      profile: baseProfile(),
      nodes: [],
      groups: [],
      rules: [],
      finalRule: { policy: "DIRECT" },
      hosts: { "*.example.com": "server:https://a/dns-query" },
      warnings,
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    const dns = parsed.dns as Record<string, unknown>;
    expect(dns["proxy-server-nameserver-policy"]).toEqual({
      "+.example.com": ["https://a/dns-query"],
    });
    expect(dns["proxy-server-nameserver"]).toBeUndefined();
    expect(out).toMatch(/# WARN:.*proxy-server-nameserver/);
  });
});
