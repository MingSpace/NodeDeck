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

  // 链式代理在导入时必须把 clash 风格 `dialer-proxy:` 字段映射到内部 chain_via,
  // 否则用户在 Clash 那边设的 chain 拓扑会被吞掉,等到生成 Surge 输出时也丢。
  it("preserves dialer-proxy as chain_via when importing", () => {
    const yaml = `
proxies:
  - name: WARP
    type: wireguard
    server: wg.example.com
    port: 2408
    private-key: PK
    public-key: PUB
    ip: 172.16.0.2/32
  - name: HK-Chain
    type: trojan
    server: hk.example.com
    port: 443
    password: pw
    sni: hk.example.com
    dialer-proxy: WARP
`;
    const r = importClashYaml(yaml);
    expect(r.manualNodes).toHaveLength(2);
    const chained = r.manualNodes.find((n) => n.name === "HK-Chain");
    expect(chained?.chain_via).toBe("WARP");
  });

  // ssr 是 Clash 端历史协议,Surge 早就移除;但 Clash yaml 仍然偶尔会出现 ssr,
  // 这里要保证 importer 不会因为某个不熟悉的字段就抛 / 把整包丢掉。
  it("imports ssr without crashing (parser handles it as ssr type)", () => {
    const yaml = `
proxies:
  - name: SSR-Old
    type: ssr
    server: 1.2.3.4
    port: 443
    cipher: aes-128-cfb
    password: x
  - name: HK-OK
    type: trojan
    server: hk.example.com
    port: 443
    password: pw
`;
    const r = importClashYaml(yaml);
    // 两个节点都应该被收进来,后续 generator 阶段才决定 ssr 怎么处理(Surge 跳过)
    expect(r.manualNodes).toHaveLength(2);
    expect(r.manualNodes.find((n) => n.type === "ssr")).toBeDefined();
    expect(r.manualNodes.find((n) => n.type === "trojan")).toBeDefined();
  });

  // Clash 完全不认识的 type(比如某些三方 fork 自定义的)走 parser 的 default→null,
  // 不应该让整包导入失败,只是这条 proxy 静默跳过。
  it("silently skips unknown proxy types without breaking import", () => {
    const yaml = `
proxies:
  - name: Unknown-Fork
    type: meowmeow
    server: 1.2.3.4
    port: 443
  - name: HK-OK
    type: trojan
    server: hk.example.com
    port: 443
    password: pw
`;
    const r = importClashYaml(yaml);
    expect(r.manualNodes).toHaveLength(1);
    expect(r.manualNodes[0].name).toBe("HK-OK");
  });

  // rule-providers 段里 format 字段用户没填时,我们默认 yaml(代码 line 84)。
  // 这是给 mihomo 端最常见的"上游 RULE-SET YAML"的兜底。
  it("defaults rule-provider format to yaml when omitted", () => {
    const yaml = `
proxies: []
rule-providers:
  no-format-rs:
    type: http
    behavior: domain
    url: https://example.com/list.yaml
`;
    const r = importClashYaml(yaml);
    expect(r.ruleSets).toHaveLength(1);
    expect(r.ruleSets[0].format).toBe("yaml");
    expect(r.ruleSets[0].behavior).toBe("domain");
  });

  // ws-opts 是 vmess/trojan/vless 通过 ws 传输时最关键的字段,parser 必须保住路径与 headers,
  // 否则跨端转换时 SNI 隔离会失效。
  it("preserves ws-opts (path + headers) for vmess ws transport", () => {
    const yaml = `
proxies:
  - name: VMess-WS
    type: vmess
    server: sg.example.com
    port: 443
    uuid: 11111111-2222-3333-4444-555555555555
    alterId: 0
    cipher: auto
    tls: true
    network: ws
    ws-opts:
      path: /vm
      headers:
        Host: sg.cdn.example.com
`;
    const r = importClashYaml(yaml);
    const vmess = r.manualNodes.find((n) => n.type === "vmess");
    expect(vmess?.network).toBe("ws");
    expect(vmess?.ws_opts?.path).toBe("/vm");
    expect(vmess?.ws_opts?.headers?.Host).toBe("sg.cdn.example.com");
  });
});
