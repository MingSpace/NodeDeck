import { describe, expect, it } from "vitest";
import { importSurgeConf } from "../../src/import/surge.js";
import { manualNodesSchema } from "../../src/schemas/node.js";

const SAMPLE_SURGE = `
[General]
loglevel = notify
ipv6 = false
allow-lan = true
internet-test-url = http://wifi.vivo.com.cn/generate_204
proxy-test-url = http://cp.cloudflare.com/generate_204
test-timeout = 5
skip-proxy = 127.0.0.0/8, 192.168.0.0/16, localhost
exclude-simple-hostnames = true
dns-server = 119.29.29.29, 223.5.5.5
encrypted-dns-server = quic://dns.alidns.com
hijack-dns = 8.8.8.8:53

[Host]
*.taobao.com = server:223.5.5.5
example.com = 1.2.3.4

[MITM]
enable = true
hostname = *.example.com, api.test.com
h2 = true
ca-p12 = BASE64CONTENTHERE
ca-passphrase = secret123

[Proxy]
🇭🇰 HK-01 = trojan, hk.example.com, 443, password=secret, sni=hk.test, skip-cert-verify=true, udp-relay=true
🇯🇵 JP-01 = ss, jp.example.com, 8388, encrypt-method=aes-128-gcm, password=pwd, udp-relay=true

[Proxy Group]
Proxys = url-test, 🇭🇰 HK-01, 🇯🇵 JP-01, url=http://cp.cloudflare.com/generate_204, interval=600, tolerance=50, timeout=5
Manual = select, Proxys, DIRECT

[Rule]
RULE-SET, https://ruleset.skk.moe/List/non_ip/cn.conf, DIRECT, extended-matching
RULE-SET, https://ruleset.skk.moe/List/ip/reject.conf, REJECT-DROP, 'notification-text="blocked"', no-resolve
FINAL, Proxys, dns-failed

[URL Rewrite]
^https://www.google.com/url\\?.*url=([^&]+) $1 302
^https://www.google.com/imgres\\?.*imgurl=([^&]+) $1 302

[Header Rewrite]
^http://example.com header-add X-Test 1
`;

describe("importSurgeConf", () => {
  it("parses general / host / mitm / proxies / groups / rules / modules", () => {
    const r = importSurgeConf(SAMPLE_SURGE);

    // general
    expect(r.general).toBeDefined();
    expect(r.general?.log_level).toBe("notify");
    expect(r.general?.ipv6).toBe(false);
    expect(r.general?.allow_lan).toBe(true);
    expect(r.general?.test_timeout).toBe(5);
    expect(r.general?.skip_proxy).toContain("127.0.0.0/8");
    expect(r.general?.exclude_simple_hostnames).toBe(true);

    // dns
    expect(r.general?.dns?.server).toEqual(["119.29.29.29", "223.5.5.5"]);
    expect(r.general?.dns?.encrypted_server).toEqual(["quic://dns.alidns.com"]);
    expect(r.general?.dns?.hijack).toEqual(["8.8.8.8:53"]);

    // hosts merged into general
    expect(r.general?.hosts).toBeDefined();
    expect(r.general?.hosts?.["example.com"]).toBe("1.2.3.4");
    expect(r.general?.hosts?.["*.taobao.com"]).toBe("server:223.5.5.5");

    // mitm
    expect(r.general?.mitm?.enable).toBe(true);
    expect(r.general?.mitm?.hostname).toEqual(["*.example.com", "api.test.com"]);
    expect(r.general?.mitm?.h2).toBe(true);
    expect(r.general?.mitm?.ca_p12).toBe("BASE64CONTENTHERE");
    expect(r.general?.mitm?.ca_passphrase).toBe("secret123");

    // nodes
    expect(r.manualNodes).toHaveLength(2);
    const trojanNode = r.manualNodes.find((n) => n.type === "trojan");
    expect(trojanNode).toBeDefined();
    expect(trojanNode?.server).toBe("hk.example.com");
    expect(trojanNode?.port).toBe(443);
    expect(trojanNode?.password).toBe("secret");
    const ssNode = r.manualNodes.find((n) => n.type === "ss");
    expect(ssNode?.server).toBe("jp.example.com");

    // rule sets
    expect(r.ruleSets.length).toBeGreaterThanOrEqual(2);
    const cnRule = r.ruleSets.find((rs) => rs.url?.includes("cn.conf"));
    expect(cnRule).toBeDefined();
    expect(cnRule?.policy).toBe("DIRECT");
    expect(cnRule?.surge_flags?.extended_matching).toBe(true);
    const rejectRule = r.ruleSets.find((rs) => rs.url?.includes("reject.conf"));
    expect(rejectRule?.surge_reject_options?.type).toBe("REJECT-DROP");
    expect(rejectRule?.surge_reject_options?.notification_text).toBe("blocked");
    expect(rejectRule?.surge_flags?.no_resolve).toBe(true);

    // proxy groups
    expect(r.proxyGroups).toHaveLength(2);
    const proxysGroup = r.proxyGroups.find((g) => g.name === "Proxys");
    expect(proxysGroup?.type).toBe("url-test");
    expect(proxysGroup?.proxies).toContain("🇭🇰 HK-01");
    expect(proxysGroup?.proxies).toContain("🇯🇵 JP-01");
    expect(proxysGroup?.url).toBe("http://cp.cloudflare.com/generate_204");
    expect(proxysGroup?.interval).toBe(600);

    // modules (URL Rewrite + Header Rewrite collected as one Imported Module)
    expect(r.modules).toHaveLength(1);
    expect(r.modules[0].content_sections.url_rewrite).toContain("google.com/url");
    expect(r.modules[0].content_sections.header_rewrite).toContain("header-add");

    expect(r.warnings).toBeDefined();
  });

  it("returns empty fields for empty input", () => {
    const r = importSurgeConf("");
    expect(r.general).toBeUndefined();
    expect(r.manualNodes).toEqual([]);
    expect(r.ruleSets).toEqual([]);
    expect(r.proxyGroups).toEqual([]);
    expect(r.modules).toEqual([]);
  });

  it("ignores SYSTEM/LAN-style RULE-SET lines (only http url ones)", () => {
    const text = `
[Rule]
RULE-SET,SYSTEM,DIRECT
RULE-SET, https://example.com/test.conf, Proxys
`;
    const r = importSurgeConf(text);
    expect(r.ruleSets).toHaveLength(1);
    expect(r.ruleSets[0].url).toBe("https://example.com/test.conf");
  });

  // 回归: Surge 配置里常见 `DIRECT = direct` 伪节点会被解析成 port=0,
  // 让 manualNodesSchema 校验失败,导致 /api/import/commit 整个 500。
  // 现在直接跳过这种伪节点,并通过 warning 告知用户。
  it("skips pseudo `direct` proxy lines and emits a warning, manualNodesSchema accepts the rest", () => {
    const text = `
[Proxy]
DIRECT = direct
DIRECT-en0 = direct, interface=en0
🇭🇰 HK = trojan, hk.example.com, 443, password=secret
`;
    const r = importSurgeConf(text);
    expect(r.manualNodes).toHaveLength(1);
    expect(r.manualNodes[0].name).toBe("🇭🇰 HK");
    expect(r.warnings.some((w) => w.includes("direct"))).toBe(true);
    const parsed = manualNodesSchema.safeParse({ nodes: r.manualNodes });
    expect(parsed.success).toBe(true);
  });

  // DOMAIN-SET 与 RULE-SET 共用前缀但语义不同 (Surge manual §4.3.5.1):
  // - DOMAIN-SET 文件每行一个域名,mihomo 端用 behavior=domain + format=text 消费
  //   (mihomo DomainTrie 同时支持 `.example.com` 与 `+.example.com` 前缀)
  // - RULE-SET 文件含混合子规则,mihomo 端用 behavior=classical
  // 同时根据 URL 后缀推断 mihomo format: .yaml/.yml→yaml, .mrs→mrs, 其余→text。
  it("recognizes DOMAIN-SET vs RULE-SET and picks behavior/format/surge_format accordingly", () => {
    const text = `
[Rule]
RULE-SET,https://example.com/rules.list,Proxy,extended-matching
RULE-SET,https://example.com/rules.yaml,DIRECT
DOMAIN-SET,https://example.com/domains.txt,DIRECT,no-resolve
DOMAIN-SET,https://example.com/cn.mrs,DIRECT
RULE-SET,SYSTEM,DIRECT
`;
    const r = importSurgeConf(text);
    expect(r.ruleSets).toHaveLength(4); // SYSTEM 仍被忽略

    const ruleSetText = r.ruleSets.find((rs) => rs.url === "https://example.com/rules.list");
    expect(ruleSetText).toMatchObject({
      type: "remote_url",
      behavior: "classical",
      format: "text",
      surge_format: "rule_set",
      clash_format: "rule_provider",
      policy: "Proxy",
    });
    expect(ruleSetText?.surge_flags?.extended_matching).toBe(true);

    const ruleSetYaml = r.ruleSets.find((rs) => rs.url === "https://example.com/rules.yaml");
    expect(ruleSetYaml).toMatchObject({ behavior: "classical", format: "yaml", surge_format: "rule_set" });

    const domainSetText = r.ruleSets.find((rs) => rs.url === "https://example.com/domains.txt");
    expect(domainSetText).toMatchObject({
      type: "remote_url",
      behavior: "domain",
      format: "text",
      surge_format: "domain_set",
      clash_format: "rule_provider",
      policy: "DIRECT",
    });
    expect(domainSetText?.surge_flags?.no_resolve).toBe(true);
    // id 命名按类型分桶,便于后续在 Web UI 区分
    expect(domainSetText?.id).toMatch(/^imported-domainset-\d+$/);

    const domainSetMrs = r.ruleSets.find((rs) => rs.url === "https://example.com/cn.mrs");
    expect(domainSetMrs).toMatchObject({ behavior: "domain", format: "mrs", surge_format: "domain_set" });
  });
});
