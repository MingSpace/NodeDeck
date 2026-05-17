import { describe, expect, it } from "vitest";
import { z } from "zod";
import { importSurgeConf } from "../../src/import/surge.js";
import { nodeSchema } from "../../src/schemas/node.js";

// 这个 test 历史上用 manualNodesSchema(已删) 校验 importer 输出。
// 现在直接校验 nodes 数组本身 — 验"importer 出来的节点全都能过 nodeSchema"这个语义。
const nodeArraySchema = z.array(nodeSchema);

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

  // http-api / ipv6-vif / wifi 系列 / always-real-ip 历史上没解析过,
  // 用户拿原配置一键导入会丢字段。这里固化解析行为,防止以后回归。
  // http-api 兼容 Surge 官方 `^` 与 NodeDeck generator 当前的 `:` 两种分隔。
  it("parses http-api / ipv6-vif / wifi-assist / allow-hotspot-access / always-real-ip", () => {
    const text = `
[General]
http-api = M1ing^secret@0.0.0.0:8890
http-api-web-dashboard = true
http-api-tls = flase
ipv6-vif = off
wifi-assist = true
allow-hotspot-access = true
allow-wifi-access = false
always-real-ip = msftconnecttest.com, *.srv.nintendo.net
proxy-test-udp = www.apple.com@64.6.64.6
geoip-maxmind-url = https://example.com/cn.mmdb
show-error-page-for-reject = true
`;
    const r = importSurgeConf(text);
    expect(r.general?.http_api).toEqual({
      user: "M1ing",
      password: "secret",
      listen: "0.0.0.0:8890",
      web_dashboard: true,
      tls: false,
    });
    expect(r.general?.ipv6_vif).toBe("off");
    expect(r.general?.wifi_assist).toBe(true);
    expect(r.general?.allow_hotspot_access).toBe(true);
    expect(r.general?.allow_wifi_access).toBe(false);
    expect(r.general?.always_real_ip).toEqual(["msftconnecttest.com", "*.srv.nintendo.net"]);
    expect(r.general?.proxy_test_udp).toBe("www.apple.com@64.6.64.6");
    expect(r.general?.geoip_maxmind_url).toBe("https://example.com/cn.mmdb");
    expect(r.general?.show_error_page_for_reject).toBe(true);
  });

  it("parses http-api with `:` separator (NodeDeck generator style) and without user", () => {
    const r1 = importSurgeConf(`[General]\nhttp-api = user:pw@127.0.0.1:8080\n`);
    expect(r1.general?.http_api).toMatchObject({ user: "user", password: "pw", listen: "127.0.0.1:8080" });

    const r2 = importSurgeConf(`[General]\nhttp-api = onlypassword@127.0.0.1:8080\n`);
    expect(r2.general?.http_api).toMatchObject({ user: "M1ing", password: "onlypassword", listen: "127.0.0.1:8080" });
  });

  // Surge 内置 ruleset SYSTEM/LAN (manual.nssurge.com/rule/ruleset.html#internal-ruleset)
  // 平台共有,导入时识别成 type=surge_internal,留给 generator 各自处理:
  // - Surge generator: 直接 `RULE-SET,<SYSTEM|LAN>,POLICY`
  // - Clash generator: LAN 展开为内联 IP-CIDR/DOMAIN-SUFFIX,SYSTEM 跳过 + warning
  it("recognizes RULE-SET,SYSTEM/LAN as type=surge_internal (preserve, don't drop)", () => {
    const text = `
[Rule]
RULE-SET,SYSTEM,DIRECT
RULE-SET,LAN, DIRECT
RULE-SET, https://example.com/test.conf, Proxys
RULE-SET,UNKNOWN-NAME,DIRECT
`;
    const r = importSurgeConf(text);
    // SYSTEM + LAN + http url = 3 条,UNKNOWN-NAME 不是内置名也不是 http URL,跳过
    expect(r.ruleSets).toHaveLength(3);

    const sys = r.ruleSets.find((rs) => rs.surge_internal_name === "SYSTEM");
    expect(sys).toMatchObject({
      type: "surge_internal",
      surge_internal_name: "SYSTEM",
      policy: "DIRECT",
      surge_format: "rule_set",
      clash_format: "rule_provider",
      name: "SYSTEM",
    });
    expect(sys?.id).toMatch(/^imported-rule-system-[0-9a-z]{6}$/);

    const lan = r.ruleSets.find((rs) => rs.surge_internal_name === "LAN");
    expect(lan).toMatchObject({
      type: "surge_internal",
      surge_internal_name: "LAN",
      policy: "DIRECT",
    });

    expect(r.ruleSets.find((rs) => rs.url === "https://example.com/test.conf")).toBeDefined();
  });

  // 回归: `[SSID Setting]` 段历史上 importer 主流程没解析,导致
  // "导入 .conf → 建 profile → 生成 .conf"链路上 SSID 段被静默丢弃,
  // 用户需要再手动到 generals 编辑器补一次。补这一刀闭合回环。
  // 同时覆盖几个边界:
  // - SSID 名含 `.` (常见,如 `Forever.`)
  // - 大小写不敏感的前缀 `ssid:`
  // - 多条 SSID 行
  // - 非 SSID 行 (`cellular=...`) 不进 general.ssid_rules (那是 SSID Proxy Group 的语法)
  it("parses [SSID Setting] into general.ssid_rules and ignores non-SSID lines", () => {
    // 与 parseHostSection / parseMitmSection 同款语义: SSID 必须挂在已有 general 上,
    // 因此 fixture 至少要带一个最小 [General] 段。
    const text = `
[General]
loglevel = notify

[SSID Setting]
SSID:Forever. suspend=true
SSID:Office policy=DIRECT
ssid:Home suspend=false policy=Proxys
cellular=Auto
default=DIRECT
`;
    const r = importSurgeConf(text);
    expect(r.general?.ssid_rules).toEqual([
      { ssid: "Forever.", suspend: true },
      { ssid: "Office", policy: "DIRECT" },
      { ssid: "Home", suspend: false, policy: "Proxys" },
    ]);
  });

  // 回归: Surge 配置里常见 `DIRECT = direct` 伪节点会被解析成 port=0,
  // 让 nodeSchema 校验失败,导致 /api/import/commit 整个 500。
  // 现在直接跳过这种伪节点,并通过 warning 告知用户。
  it("skips pseudo `direct` proxy lines and emits a warning, nodeSchema accepts the rest", () => {
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
    const parsed = nodeArraySchema.safeParse(r.manualNodes);
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
RULE-SET,FOO_BAR_NOT_INTERNAL,DIRECT
`;
    const r = importSurgeConf(text);
    expect(r.ruleSets).toHaveLength(4); // 非 SYSTEM/LAN 且非 http URL 的引用仍被忽略

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
    // id 命名按类型分桶 + 带 url 推断的 slug + 6 位 nanoid 后缀,便于后续在 Web UI / 文件夹区分
    expect(domainSetText?.id).toMatch(/^imported-domainset-domains-[0-9a-z]{6}$/);

    const domainSetMrs = r.ruleSets.find((rs) => rs.url === "https://example.com/cn.mrs");
    expect(domainSetMrs).toMatchObject({ behavior: "domain", format: "mrs", surge_format: "domain_set" });
  });
});
