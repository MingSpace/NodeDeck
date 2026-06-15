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

  it("returns empty for non-clash yaml", () => {
    expect(parseClashYaml("foo: bar")).toEqual([]);
    expect(parseClashYaml("")).toEqual([]);
  });
});
