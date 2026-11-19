import { describe, expect, it } from "vitest";
import { parseClashYaml } from "../../src/parsers/clash.js";

describe("parseClashYaml", () => {
  it("parses ss + trojan + hysteria2 + vless reality", () => {
    const yaml = `
proxies:
  - name: 🇭🇰 HK-SS
    type: ss
    server: 8d4a2926.example.com
    port: 15017
    cipher: 2022-blake3-aes-128-gcm
    password: fake-ss-pwd==
    udp: true
  - name: 🇯🇵 JP-Trojan
    type: trojan
    server: sh.example.com
    port: 12111
    password: secret
    sni: m.ctrip.com
    skip-cert-verify: true
    udp: true
  - name: HY2
    type: hysteria2
    server: hy2.example.com
    port: 443
    password: hypass
    obfs: salamander
    obfs-password: obfspw
    sni: hy2.example.com
    alpn: [h3]
    ports: 443-8443
    hop-interval: 30
  - name: VLESS-Reality
    type: vless
    server: r.example.com
    port: 443
    uuid: abcdef00-1234-5678-9abc-def012345678
    tls: true
    flow: xtls-rprx-vision
    network: tcp
    client-fingerprint: chrome
    reality-opts:
      public-key: PUBKEY
      short-id: ABCD
`;
    const nodes = parseClashYaml(yaml);
    expect(nodes).toHaveLength(4);
    expect(nodes[0]).toMatchObject({
      type: "ss",
      cipher: "2022-blake3-aes-128-gcm",
      port: 15017,
      udp: true,
    });
    expect(nodes[1]).toMatchObject({ type: "trojan", sni: "m.ctrip.com", skip_cert_verify: true });
    expect(nodes[2]).toMatchObject({
      type: "hysteria2",
      obfs: "salamander",
      obfs_password: "obfspw",
      port_hopping: "443-8443",
      hop_interval: 30,
    });
    expect(nodes[3]).toMatchObject({
      type: "vless",
      flow: "xtls-rprx-vision",
      reality_opts: { public_key: "PUBKEY", short_id: "ABCD" },
    });
  });

  it("parses dialer-proxy chain field", () => {
    const yaml = `
proxies:
  - name: A
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-128-gcm
    password: x
    dialer-proxy: B
`;
    const nodes = parseClashYaml(yaml);
    expect(nodes[0].chain_via).toBe("B");
  });

  it("ss 的 plugin: shadow-tls 归一化到 shadow_tls_* 字段;其它 plugin 原样透传", () => {
    const yaml = `
proxies:
  - name: STLS
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-128-gcm
    password: x
    plugin: shadow-tls
    plugin-opts:
      host: cloud.tencent.com
      password: stls-pwd
      version: 3
  - name: OBFS
    type: ss
    server: 5.6.7.8
    port: 443
    cipher: aes-128-gcm
    password: y
    plugin: obfs
    plugin-opts:
      mode: tls
      host: bing.com
`;
    const nodes = parseClashYaml(yaml);
    expect(nodes[0]).toMatchObject({
      shadow_tls_password: "stls-pwd",
      shadow_tls_sni: "cloud.tencent.com",
      shadow_tls_version: 3,
    });
    expect(nodes[0].plugin).toBeUndefined();
    expect(nodes[1]).toMatchObject({
      plugin: "obfs",
      plugin_opts: { mode: "tls", host: "bing.com" },
    });
    expect(nodes[1].shadow_tls_password).toBeUndefined();
  });

  it("shadow-tls 缺 password 时不归一化,plugin 原样透传(避免 roundtrip 丢字段)", () => {
    const yaml = `
proxies:
  - name: STLS-NOPWD
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-128-gcm
    password: x
    plugin: shadow-tls
    plugin-opts:
      host: cloud.tencent.com
      version: 3
`;
    const nodes = parseClashYaml(yaml);
    expect(nodes[0].shadow_tls_password).toBeUndefined();
    expect(nodes[0]).toMatchObject({
      plugin: "shadow-tls",
      plugin_opts: { host: "cloud.tencent.com", version: 3 },
    });
  });

  it("parses 通用字段 mptcp / hysteria2 obfs gecko", () => {
    const yaml = `
proxies:
  - name: SS-MPTCP
    type: ss
    server: 1.2.3.4
    port: 443
    cipher: aes-128-gcm
    password: x
    mptcp: true
  - name: HY2-GECKO
    type: hysteria2
    server: hy2.example.com
    port: 443
    password: pw
    obfs: gecko
    obfs-password: gp
`;
    const nodes = parseClashYaml(yaml);
    expect(nodes[0].mptcp).toBe(true);
    expect(nodes[1]).toMatchObject({ obfs: "gecko", obfs_password: "gp" });
  });

  // 以下用例从已删除的 Clash 整包导入 / Clash 输出 round-trip 测试迁来,只保留输入解析部分。

  // ssr 是 Clash 端历史协议,Surge 不支持;但机场订阅里仍偶尔出现,parser 必须收下而不是抛错
  // (生成 Surge 时才跳过)。
  it("parses ssr without crashing alongside other proxies", () => {
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
    const nodes = parseClashYaml(yaml);
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.type === "ssr")).toBeDefined();
    expect(nodes.find((n) => n.type === "trojan")).toBeDefined();
  });

  // 不认识的 type(某些三方 fork 自定义的)静默跳过,不影响同一份订阅里的其它节点。
  it("silently skips unknown proxy types", () => {
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
    const nodes = parseClashYaml(yaml);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("HK-OK");
  });

  // ws-opts 是 vmess/trojan/vless 走 ws 传输时最关键的字段,path 与 headers 必须保住。
  it("preserves ws-opts (path + headers) and alterId for vmess ws transport", () => {
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
    const vmess = parseClashYaml(yaml).find((n) => n.type === "vmess");
    expect(vmess).toMatchObject({
      uuid: "11111111-2222-3333-4444-555555555555",
      alter_id: 0,
      cipher: "auto",
      tls: true,
      network: "ws",
      ws_opts: { path: "/vm", headers: { Host: "sg.cdn.example.com" } },
    });
  });

  // mihomo 的 vmess/vless 用 servername 写 SNI,其余协议用 sni;内部统一折叠进 sni,有 sni 时以 sni 为准。
  it("folds vmess/vless servername into sni", () => {
    const yaml = `
proxies:
  - name: VM
    type: vmess
    server: vm.example.com
    port: 443
    uuid: 11111111-2222-3333-4444-555555555555
    tls: true
    servername: cdn.example.com
  - name: VL
    type: vless
    server: vl.example.com
    port: 443
    uuid: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
    tls: true
    servername: cdn.example.com
    sni: real.example.com
`;
    const nodes = parseClashYaml(yaml);
    expect(nodes[0].sni).toBe("cdn.example.com");
    expect(nodes[0].servername).toBeUndefined();
    expect(nodes[1].sni).toBe("real.example.com");
  });

  // 原先的 Clash round-trip 用例:trojan(sni / skip-cert-verify)、ss、vless reality、dialer-proxy
  // 一起出现时各字段都能读回内部模型。
  it("reads trojan / ss / vless reality / dialer-proxy together", () => {
    const yaml = `
proxies:
  - name: JP-1
    type: trojan
    server: jp.example.com
    port: 443
    password: p@ss
    sni: jp.example.com
    skip-cert-verify: true
  - name: HK-1
    type: ss
    server: hk.example.com
    port: 8388
    cipher: aes-256-gcm
    password: secret
  - name: US-Reality
    type: vless
    server: us.example.com
    port: 443
    uuid: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee
    flow: xtls-rprx-vision
    tls: true
    servername: www.cloudflare.com
    reality-opts:
      public-key: PUB
      short-id: abcd1234
  - name: Chain-Back
    type: trojan
    server: back.example.com
    port: 443
    password: back-pwd
    sni: back.example.com
    dialer-proxy: HK-1
`;
    const nodes = parseClashYaml(yaml);
    expect(nodes.map((n) => n.name)).toEqual(["JP-1", "HK-1", "US-Reality", "Chain-Back"]);
    expect(nodes[0]).toMatchObject({ type: "trojan", password: "p@ss", sni: "jp.example.com", skip_cert_verify: true });
    expect(nodes[1]).toMatchObject({ type: "ss", cipher: "aes-256-gcm", password: "secret" });
    expect(nodes[2]).toMatchObject({
      type: "vless",
      flow: "xtls-rprx-vision",
      sni: "www.cloudflare.com",
      reality_opts: { public_key: "PUB", short_id: "abcd1234" },
    });
    expect(nodes[3].chain_via).toBe("HK-1");
  });

  it("returns empty for non-clash yaml", () => {
    expect(parseClashYaml("foo: bar")).toEqual([]);
    expect(parseClashYaml("")).toEqual([]);
  });
});
