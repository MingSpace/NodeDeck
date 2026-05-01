import { describe, expect, it } from "vitest";
import { importClashYaml } from "../../src/import/clash.js";

const SAMPLE_CLASH = `
port: 7890
socks-port: 7891
mixed-port: 7892
allow-lan: true
mode: rule
log-level: info
ipv6: false
hosts:
  example.com: 1.2.3.4
dns:
  enable: true
  listen: 0.0.0.0:53
  enhanced-mode: fake-ip
  fake-ip-range: 198.18.0.1/16
  nameserver:
    - 119.29.29.29
    - 223.5.5.5
  fallback:
    - https://1.1.1.1/dns-query

proxies:
  - name: 🇭🇰 HK-01
    type: trojan
    server: hk.example.com
    port: 443
    password: secret
    sni: hk.test
    skip-cert-verify: true
    udp: true
  - name: 🇯🇵 JP-01
    type: ss
    server: jp.example.com
    port: 8388
    cipher: aes-128-gcm
    password: pwd
    udp: true

proxy-groups:
  - name: Proxys
    type: url-test
    proxies: ['🇭🇰 HK-01', '🇯🇵 JP-01']
    url: http://cp.cloudflare.com/generate_204
    interval: 300
    tolerance: 50
    timeout: 5
  - name: Manual
    type: select
    proxies: [Proxys, DIRECT]

rule-providers:
  cn-direct:
    type: http
    behavior: domain
    url: https://example.com/cn.yaml
    format: yaml
    interval: 86400
  reject-list:
    type: http
    behavior: classical
    url: https://example.com/reject.yaml

rules:
  - 'RULE-SET,cn-direct,DIRECT'
  - 'RULE-SET,reject-list,REJECT'
  - 'MATCH,Proxys'
`;

describe("importClashYaml", () => {
  it("parses general / hosts / dns / proxies / proxy-groups / rule-providers", () => {
    const r = importClashYaml(SAMPLE_CLASH);

    expect(r.general).toBeDefined();
    expect(r.general?.port).toBe(7890);
    expect(r.general?.socks_port).toBe(7891);
    expect(r.general?.mixed_port).toBe(7892);
    expect(r.general?.allow_lan).toBe(true);
    expect(r.general?.mode).toBe("rule");
    expect(r.general?.ipv6).toBe(false);
    expect(r.general?.hosts?.["example.com"]).toBe("1.2.3.4");

    expect(r.general?.dns?.enable).toBe(true);
    expect(r.general?.dns?.listen).toBe("0.0.0.0:53");
    expect(r.general?.dns?.enhanced_mode).toBe("fake-ip");
    expect(r.general?.dns?.fake_ip_range).toBe("198.18.0.1/16");
    expect(r.general?.dns?.nameserver).toEqual(["119.29.29.29", "223.5.5.5"]);
    expect(r.general?.dns?.fallback).toEqual(["https://1.1.1.1/dns-query"]);

    expect(r.manualNodes).toHaveLength(2);
    const trojan = r.manualNodes.find((n) => n.type === "trojan");
    expect(trojan?.password).toBe("secret");
    expect(trojan?.skip_cert_verify).toBe(true);
    const ss = r.manualNodes.find((n) => n.type === "ss");
    expect(ss?.cipher).toBe("aes-128-gcm");

    expect(r.ruleSets).toHaveLength(2);
    const cnRule = r.ruleSets.find((rs) => rs.url?.includes("cn.yaml"));
    expect(cnRule?.behavior).toBe("domain");
    expect(cnRule?.format).toBe("yaml");
    const rejectRule = r.ruleSets.find((rs) => rs.url?.includes("reject.yaml"));
    expect(rejectRule?.behavior).toBe("classical");

    expect(r.proxyGroups).toHaveLength(2);
    const proxys = r.proxyGroups.find((g) => g.name === "Proxys");
    expect(proxys?.type).toBe("url-test");
    expect(proxys?.proxies).toEqual(["🇭🇰 HK-01", "🇯🇵 JP-01"]);
    expect(proxys?.url).toBe("http://cp.cloudflare.com/generate_204");
    expect(proxys?.interval).toBe(300);
    const manual = r.proxyGroups.find((g) => g.name === "Manual");
    expect(manual?.type).toBe("select");
    expect(manual?.proxies).toEqual(["Proxys", "DIRECT"]);
  });

  it("warns on empty yaml", () => {
    const r = importClashYaml("");
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.manualNodes).toEqual([]);
  });

  it("handles missing dns/hosts gracefully", () => {
    const r = importClashYaml("port: 7890\nproxies: []\n");
    expect(r.general?.port).toBe(7890);
    expect(r.general?.dns).toBeUndefined();
    expect(r.manualNodes).toEqual([]);
  });
});
