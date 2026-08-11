import { describe, expect, it } from "vitest";
import { generateSurgeConfig } from "../../src/generators/surge.js";
import { importSurgeConf } from "../../src/import/surge.js";
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
        ca_passphrase: "example-ca-pass",
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
    // 组行不带 url= —— Surge 现行版本已废弃组级测试 URL(只认 per-policy test-url /
    // [General] proxy-test-url),g.url 只服务于 Clash 端。
    expect(out).toContain("Proxys = url-test,🇭🇰 HK-01,🇭🇰 HK-SS,interval=600,tolerance=10");

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
    expect(out).toContain("ca-passphrase = example-ca-pass");
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

  it("组级 underlying-proxy: 输出到 [Proxy Group] 行,legacy 组级 url 不再输出", () => {
    const nodes: Node[] = [
      { name: "JP-01", type: "ss", server: "j.com", port: 8388, cipher: "aes-128-gcm", password: "x", region: "JP", tags: [] },
      { name: "Relay", type: "ss", server: "r.com", port: 8388, cipher: "aes-128-gcm", password: "x", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      {
        id: "Front",
        name: "Front",
        type: "url-test",
        proxies: ["Relay"],
        nested_groups: [],
        url: "http://cp.cloudflare.com",
        interval: 300,
      },
      {
        id: "Landing",
        name: "Landing",
        type: "select",
        proxies: ["JP-01"],
        nested_groups: [],
        underlying_proxy: "Front",
      },
    ];
    const warnings: string[] = [];
    const out = generateSurgeConfig({
      profile: baseProfile({ proxy_groups: ["Front", "Landing"] }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "Landing" },
      surgeModules: [],
      warnings,
    });
    const lines = out.split(/\r?\n/);
    expect(lines.find((l) => l.startsWith("Landing = "))).toBe("Landing = select,JP-01,underlying-proxy=Front");
    // 同一份配置里,组级 url 被丢弃但 interval 仍保留
    const frontLine = lines.find((l) => l.startsWith("Front = "))!;
    expect(frontLine).not.toContain("url=");
    expect(frontLine).toContain("interval=300");
    expect(warnings).toEqual([]);
  });

  it("socks5 + tls 还原为 socks5-tls 类型关键字", () => {
    // Surge 的 socks5-tls 是独立类型关键字,不是 socks5 加个参数;
    // parser 读进来折叠成 type=socks5 + tls,导出时必须还原,否则静默退化成明文。
    const nodes: Node[] = [
      { name: "S5T", type: "socks5", server: "s.com", port: 443, username: "u", password: "p", tls: true, tags: [] },
      { name: "S5", type: "socks5", server: "s2.com", port: 1080, tags: [] },
    ];
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes,
      groups: [],
      rules: [],
      surgeModules: [],
      warnings: [],
    });
    expect(out).toContain("S5T = socks5-tls, s.com, 443");
    expect(out).toContain("S5 = socks5, s2.com, 1080");
  });

  it("vless 整节点跳过 + warning(Surge 没有这个协议)", () => {
    const warnings: string[] = [];
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes: [
        { name: "VL", type: "vless", server: "v.com", port: 443, uuid: "u", tls: true, flow: "xtls-rprx-vision", tags: [] },
        { name: "TJ", type: "trojan", server: "t.com", port: 443, password: "p", tls: true, tags: [] },
      ],
      groups: [],
      rules: [],
      surgeModules: [],
      warnings,
    });
    expect(out).not.toContain("VL = ");
    expect(out).not.toContain("vless-flow");
    expect(out).toContain("TJ = trojan");
    expect(warnings.some((w) => w.includes("VL") && w.includes("vless"))).toBe(true);
  });

  it("wireguard 支持 underlying-proxy(此前被误判为不支持而丢弃)", () => {
    const nodes: Node[] = [
      { name: "Relay", type: "ss", server: "r.com", port: 8388, cipher: "aes-128-gcm", password: "x", tags: [] },
      {
        name: "WARP",
        type: "wireguard",
        server: "wg.com",
        port: 2408,
        private_key: "PK",
        public_key: "PUB",
        ip: "10.0.0.2/32",
        chain_via: "Relay",
        wg_dns_server: ["1.1.1.1", "8.8.8.8"],
        wg_prefer_ipv6: false,
        peers: [{ server: "wg.com", port: 2408, public_key: "PUB", allowed_ips: ["0.0.0.0/0"], keepalive: 25 }],
        tags: [],
      },
    ];
    const warnings: string[] = [];
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes,
      groups: [],
      rules: [],
      surgeModules: [],
      warnings,
    });
    expect(out).toContain("WARP = wireguard, section-name=WARP, underlying-proxy=Relay");
    expect(out).toContain("dns-server = 1.1.1.1, 8.8.8.8");
    expect(out).toContain("prefer-ipv6 = false");
    expect(out).toContain("keepalive = 25");
    expect(warnings.some((w) => w.includes("underlying-proxy"))).toBe(false);
  });

  it("节点级测速参数 / server-cert-verify-name / ip-version 映射", () => {
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes: [
        {
          name: "N",
          type: "trojan",
          server: "t.com",
          port: 443,
          password: "p",
          tls: true,
          sni: "fake.example.com",
          name_cert_verify: "real.example.com",
          ip_version: "ipv4-prefer",
          test_url: "http://cp.cloudflare.com/generate_204",
          test_timeout: 3,
          test_udp: "google.com@1.1.1.1",
          tags: [],
        },
      ],
      groups: [],
      rules: [],
      surgeModules: [],
      warnings: [],
    });
    const line = out.split(/\r?\n/).find((l) => l.startsWith("N = "))!;
    expect(line).toContain("server-cert-verify-name=real.example.com");
    // 内部用 mihomo 枚举,Surge 侧取值不同,必须映射
    expect(line).toContain("ip-version=prefer-v4");
    expect(line).toContain("test-url=http://cp.cloudflare.com/generate_204");
    expect(line).toContain("test-timeout=3");
    expect(line).toContain("test-udp=google.com@1.1.1.1");
  });

  it("smart 组:不输出无效的 interval,输出 policy-priority / icon-url,并对嵌套成员告警", () => {
    const nodes: Node[] = [
      { name: "JP-01", type: "ss", server: "j.com", port: 8388, cipher: "aes-128-gcm", password: "x", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      { id: "Sub", name: "Sub", type: "select", proxies: ["JP-01"], nested_groups: [] },
      {
        id: "Smart",
        name: "Smart",
        type: "smart",
        proxies: ["JP-01", "DIRECT"],
        nested_groups: ["Sub"],
        interval: 600,
        policy_priority: "IPLC:0.5;实验:2",
        icon_url: "https://example.com/i.png",
      },
    ];
    const warnings: string[] = [];
    const out = generateSurgeConfig({
      profile: baseProfile({ proxy_groups: ["Sub", "Smart"] }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "Smart" },
      surgeModules: [],
      warnings,
    });
    const line = out.split(/\r?\n/).find((l) => l.startsWith("Smart = "))!;
    expect(line).not.toContain("interval=");
    expect(line).toContain('policy-priority="IPLC:0.5;实验:2"');
    expect(line).toContain("icon-url=https://example.com/i.png");
    // Surge 的 smart 组会静默忽略嵌套组与内置策略,这里要主动提示
    expect(warnings.some((w) => w.includes("Smart") && w.includes("Sub") && w.includes("DIRECT"))).toBe(true);
  });

  it("RULE-SET / DOMAIN-SET 行按需输出 update-interval", () => {
    const mk = (id: string, interval: number, format: "rule_set" | "domain_set"): RuleSet => ({
      id,
      name: id,
      type: "remote_url",
      url: `https://example.com/${id}.list`,
      behavior: "classical",
      format: "text",
      clash_format: "rule_provider",
      surge_format: format,
      update_interval: interval,
    });
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes: [],
      groups: [],
      rules: [
        { ref: "a", policy: "DIRECT", ruleset: mk("a", 3600, "rule_set") },
        { ref: "b", policy: "DIRECT", ruleset: mk("b", 86400, "rule_set") },
        { ref: "c", policy: "DIRECT", ruleset: mk("c", 7200, "domain_set") },
      ],
      surgeModules: [],
      warnings: [],
    });
    expect(out).toContain("RULE-SET,https://example.com/a.list,DIRECT,update-interval=3600");
    // 默认值不输出,避免产物噪音
    expect(out).toContain("RULE-SET,https://example.com/b.list,DIRECT");
    expect(out).not.toContain("b.list,DIRECT,update-interval");
    expect(out).toContain("DOMAIN-SET,https://example.com/c.list,DIRECT,update-interval=7200");
  });

  it("组级 underlying-proxy: 指向的节点被改名时同步改写,不留悬空", () => {
    // 两个机场同名节点 → uniquifyNodeNames 加来源前缀;Surge 名称净化再把 `=` 换成 `_`。
    // 两条改名路径都必须把 underlying_proxy 一起带走,否则组级链式会指向一个已不存在的名字。
    const nodes: Node[] = [
      { name: "Relay=A", type: "ss", server: "r1.com", port: 8388, cipher: "aes-128-gcm", password: "x", source_provider_id: "p1", tags: [] },
      { name: "JP-01", type: "ss", server: "j.com", port: 8388, cipher: "aes-128-gcm", password: "x", source_provider_id: "p2", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      { id: "Landing", name: "Landing", type: "select", proxies: ["JP-01"], nested_groups: [], underlying_proxy: "Relay=A" },
    ];
    const warnings: string[] = [];
    const out = generateSurgeConfig({
      profile: baseProfile({ proxy_groups: ["Landing"] }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "Landing" },
      surgeModules: [],
      warnings,
    });
    const lines = out.split(/\r?\n/);
    expect(lines.some((l) => l.startsWith("Relay_A = "))).toBe(true);
    expect(lines.find((l) => l.startsWith("Landing = "))).toContain("underlying-proxy=Relay_A");
    // 改名同步生效 => 不应该出现悬空降级的 warning
    expect(warnings.some((w) => w.includes("组级链式出口"))).toBe(false);
  });

  it("组级 underlying-proxy: 悬空 / 自引用都降级为忽略 + warning", () => {
    const nodes: Node[] = [
      { name: "JP-01", type: "ss", server: "j.com", port: 8388, cipher: "aes-128-gcm", password: "x", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      { id: "Dangling", name: "Dangling", type: "select", proxies: ["JP-01"], nested_groups: [], underlying_proxy: "不存在的前置" },
      { id: "SelfRef", name: "SelfRef", type: "select", proxies: ["JP-01"], nested_groups: [], underlying_proxy: "SelfRef" },
    ];
    const warnings: string[] = [];
    const out = generateSurgeConfig({
      profile: baseProfile({ proxy_groups: ["Dangling", "SelfRef"] }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "Dangling" },
      surgeModules: [],
      warnings,
    });
    expect(out).not.toContain("underlying-proxy=");
    expect(warnings.some((w) => w.includes("Dangling") && w.includes("既不是节点也不是已启用的策略组"))).toBe(true);
    expect(warnings.some((w) => w.includes("SelfRef") && w.includes("指向本组自己"))).toBe(true);
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

  // 混合 payload(域名 + IP 混写)展开进 [Rule] 时,规则集级别的 no-resolve 只对 IP 行有意义;
  // 挂到 DOMAIN 行上属于不适用参数(manual.nssurge.com/rules/overview.html 参数表)。
  it("distributes inline payload flags by rule type and keeps the policy ahead of options", () => {
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes: [],
      groups: [],
      rules: [
        {
          ref: "nas",
          policy: "DEVICE:MS-MACMINI",
          ruleset: {
            id: "nas",
            name: "NAS",
            type: "inline_list",
            payload: [
              "DOMAIN,nas.example.com",
              "IP-CIDR,10.0.0.0/24",
              // 用户在行内自己写了 option:必须挪到策略之后
              "IP-CIDR6,fd00::/8,no-resolve",
              "PROCESS-NAME,Transmission",
            ],
            behavior: "classical",
            format: "yaml",
            surge_flags: { no_resolve: true, extended_matching: true },
            clash_format: "inline",
            surge_format: "rule_set",
            update_interval: 86400,
          } satisfies RuleSet,
        },
      ],
      surgeModules: [],
      warnings: [],
    });
    expect(out).toContain("DOMAIN,nas.example.com,DEVICE:MS-MACMINI,extended-matching");
    expect(out).toContain("IP-CIDR,10.0.0.0/24,DEVICE:MS-MACMINI,no-resolve");
    expect(out).toContain("IP-CIDR6,fd00::/8,DEVICE:MS-MACMINI,no-resolve");
    expect(out).toContain("PROCESS-NAME,Transmission,DEVICE:MS-MACMINI");
    // 域名行不该带 no-resolve,IP 行不该带 extended-matching
    expect(out).not.toContain("DOMAIN,nas.example.com,DEVICE:MS-MACMINI,no-resolve");
    expect(out).not.toContain("IP-CIDR,10.0.0.0/24,DEVICE:MS-MACMINI,extended-matching");
    // 行内 option 不能顶掉策略的位置
    expect(out).not.toContain("IP-CIDR6,fd00::/8,no-resolve,DEVICE:MS-MACMINI");
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

  // 手册: `http-api = key@ip:port`,key 是不可再切分的整串密钥。含 `^` / `:` 的 key 曾被
  // 当成 user/password 分隔符拆开、再用 `:` 拼回,导致 key 静默改变、Surge 侧 X-Key
  // 失配。这里锁住"导入再回写必须逐字符还原"。
  it("round-trips the http-api key verbatim through import → generate", () => {
    for (const key of ["alpha^bravo", "onlykey", "user:pw", "k^e:y"]) {
      const parsed = importSurgeConf(`[General]\nhttp-api = ${key}@0.0.0.0:8890\n`).general?.http_api;
      const out = generateSurgeConfig({
        profile: baseProfile(),
        nodes: [],
        groups: [],
        rules: [],
        general: {
          id: "g",
          name: "g",
          allow_lan: false,
          mode: "rule",
          log_level: "notify",
          ipv6: false,
          http_api: parsed,
        },
        surgeModules: [],
        warnings: [],
      });
      expect(out).toContain(`http-api = ${key}@0.0.0.0:8890`);
    }
  });

  // `[SSID Setting]`(官方名 Subnet Settings)一行 = subnet 表达式 + **逗号分隔**参数。
  // 早期实现是空格分隔且会输出手册里不存在的 `policy=`,两者都会让 Surge 读不对。
  function surgeWithSsidRules(
    ssid_rules: NonNullable<GeneralPreset["ssid_rules"]>,
    warnings: string[] = [],
  ): string {
    return generateSurgeConfig({
      profile: baseProfile(),
      nodes: [],
      groups: [],
      rules: [],
      general: { id: "g", name: "g", allow_lan: false, mode: "rule", log_level: "notify", ipv6: false, ssid_rules },
      surgeModules: [],
      warnings,
    });
  }

  it("emits [SSID Setting] with comma-separated params and quotes expressions containing spaces", () => {
    const out = surgeWithSsidRules([
      { match: "SSID:Forever.", suspend: true },
      {
        match: "SSID:My Home",
        tfo_behaviour: "force-enabled",
        cellular_fallback: "off",
        dns_server: ["192.168.1.1", "system"],
        encrypted_dns_server: ["off"],
      },
      { match: "TYPE:CELLULAR", cellular_mode: true },
      { match: "ROUTER:192.168.2.1", suspend: false },
    ]);
    expect(out).toContain("[SSID Setting]");
    expect(out).toContain("SSID:Forever. suspend=true");
    // 列表型参数(自身也用逗号分隔多值)排在最后,靠"token 里有没有 = "区分归属
    expect(out).toContain(
      '"SSID:My Home" cellular-fallback=off,tfo-behaviour=force-enabled,dns-server=192.168.1.1,system,encrypted-dns-server=off',
    );
    expect(out).toContain("TYPE:CELLULAR cellular-mode=true");
    expect(out).toContain("ROUTER:192.168.2.1 suspend=false");
    // 手册里本段没有 policy 参数,任何情况下都不该出现
    expect(out).not.toContain("policy=");
  });

  it("skips [SSID Setting] rows with no expression or no effective param, with warnings", () => {
    const warnings: string[] = [];
    const out = surgeWithSsidRules([{ match: "" }, { match: "SSID:Empty" }], warnings);
    // 段名本身还会出现在文件头的 `# WARN:` 里,所以按整行匹配
    expect(out).not.toMatch(/^\[SSID Setting\]$/m);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("没填网络匹配表达式");
    expect(warnings[1]).toContain("SSID:Empty");
  });

  // VPN Tunnel Scope(iOS 独占)。include-apns 是大陆 APNs 直连受干扰时让推送走隧道的开关,
  // 漏输出会让用户以为在 Web UI 里开了、而客户端拿到的 conf 里根本没这行。
  it("emits [General] VPN tunnel scope keys", () => {
    const out = generateSurgeConfig({
      profile: baseProfile(),
      nodes: [],
      groups: [],
      rules: [],
      general: {
        id: "g",
        name: "g",
        allow_lan: false,
        mode: "rule",
        log_level: "notify",
        ipv6: false,
        include_all_networks: true,
        include_apns: true,
        include_local_networks: false,
      },
      surgeModules: [],
      warnings: [],
    });
    expect(out).toContain("include-all-networks = true");
    expect(out).toContain("include-apns = true");
    expect(out).toContain("include-local-networks = false");
    // 未设置的键不输出,避免给 conf 塞一堆等于默认值的行
    expect(out).not.toContain("include-cellular-services");
  });

  it("imports VPN tunnel scope keys and drops dependents left without include-all-networks", () => {
    const ok = importSurgeConf(
      "[General]\ninclude-all-networks = true\ninclude-apns = true\ninclude-cellular-services = true\n",
    );
    expect(ok.general).toMatchObject({
      include_all_networks: true,
      include_apns: true,
      include_cellular_services: true,
    });
    // 上游没写的键保持 undefined,不能变成显式 false
    expect(ok.general?.include_local_networks).toBeUndefined();

    // Surge 自己会忽略单开的子项;原样导入会撞上 schema 依赖校验让整包导入失败
    const orphan = importSurgeConf("[General]\ninclude-apns = true\n");
    expect(orphan.general?.include_apns).toBeUndefined();
    expect(orphan.warnings.some((w) => w.includes("include_apns"))).toBe(true);
  });
});
