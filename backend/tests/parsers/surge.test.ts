import { describe, expect, it } from "vitest";
import { parseSurgeConf, parseSurgeProxyLine } from "../../src/parsers/surge.js";

describe("parseSurgeConf", () => {
  it("parses [Proxy] section with trojan + ss-2022 + hysteria2", () => {
    const conf = `
[General]
loglevel = notify

[Proxy]
DIRECT = direct
🇭🇰 HK-Trojan = trojan, gzdata1.233netbest.com, 12101, password=secret, sni=m.ctrip.com, skip-cert-verify=true, tfo=true, udp-relay=true
🇭🇰 HK-SS-2022 = ss, 8d4a2926.ovalyraa.com, 15017, encrypt-method=2022-blake3-aes-128-gcm, password="aLBxsnzSc2Gb8Q72O0HHhw==", tfo=true, udp-relay=true
HY2 = hysteria2, hy2.example.com, 443, password=hypass, download-bandwidth=200, obfs=salamander, obfs-password=op, port-hopping=443-8443, port-hopping-interval=30
WG = wireguard, wg.example.com, 2408, private-key=PRIV, public-key=PUB, self-ip=172.16.0.2, mtu=1280

[Proxy Group]
Auto = url-test, A, B
`;
    const nodes = parseSurgeConf(conf);
    expect(nodes).toHaveLength(5);
    expect(nodes[0]).toMatchObject({ type: "direct", name: "DIRECT" });
    expect(nodes[1]).toMatchObject({
      type: "trojan",
      name: "🇭🇰 HK-Trojan",
      server: "gzdata1.233netbest.com",
      port: 12101,
      password: "secret",
      sni: "m.ctrip.com",
      skip_cert_verify: true,
      tfo: true,
      udp: true,
      tls: true,
    });
    expect(nodes[2]).toMatchObject({
      type: "ss",
      cipher: "2022-blake3-aes-128-gcm",
      password: "aLBxsnzSc2Gb8Q72O0HHhw==",
    });
    expect(nodes[3]).toMatchObject({
      type: "hysteria2",
      down: "200",
      obfs: "salamander",
      obfs_password: "op",
      port_hopping: "443-8443",
      hop_interval: 30,
    });
    expect(nodes[4]).toMatchObject({
      type: "wireguard",
      private_key: "PRIV",
      public_key: "PUB",
      ip: "172.16.0.2",
      mtu: 1280,
    });
  });

  it("parses underlying-proxy chain field", () => {
    const node = parseSurgeProxyLine(
      "Chained = trojan, server.com, 443, password=xx, underlying-proxy=Front",
    );
    expect(node?.chain_via).toBe("Front");
  });

  it("parses VLESS Reality from Surge", () => {
    const node = parseSurgeProxyLine(
      "VR = vless, r.example.com, 443, uuid=abc-def, vless-flow=xtls-rprx-vision, reality-public-key=PK, reality-short-id=SID, sni=www.cloudflare.com, tls-fingerprint=chrome",
    );
    expect(node).toMatchObject({
      type: "vless",
      uuid: "abc-def",
      flow: "xtls-rprx-vision",
      reality_opts: { public_key: "PK", short_id: "SID" },
      sni: "www.cloudflare.com",
      client_fingerprint: "chrome",
    });
  });

  it("returns empty for missing [Proxy] section", () => {
    expect(parseSurgeConf("[General]\nfoo=bar")).toEqual([]);
  });
});
