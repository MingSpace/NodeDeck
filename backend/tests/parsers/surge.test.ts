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
    // `DIRECT = direct` 是 Surge 内置策略的伪节点,parser 故意丢弃 (port=0 也无法过 schema)。
    expect(nodes).toHaveLength(4);
    expect(nodes.find((n) => n.name === "DIRECT")).toBeUndefined();
    expect(nodes[0]).toMatchObject({
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
    expect(nodes[1]).toMatchObject({
      type: "ss",
      cipher: "2022-blake3-aes-128-gcm",
      password: "aLBxsnzSc2Gb8Q72O0HHhw==",
    });
    expect(nodes[2]).toMatchObject({
      type: "hysteria2",
      down: "200",
      obfs: "salamander",
      obfs_password: "op",
      port_hopping: "443-8443",
      hop_interval: 30,
    });
    expect(nodes[3]).toMatchObject({
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
    // `tls-fingerprint`(uTLS)不应泄漏进 `fingerprint`(证书锁定)。
    expect(node?.fingerprint).toBeUndefined();
  });

  it("parses AnyTLS with server-cert-fingerprint-sha256 (cert pinning)", () => {
    const node = parseSurgeProxyLine(
      "🇭🇰 HK = anytls, 8d4a2926.ovalyraa.com, 15026, password=pwd, tfo=true, sni=ixigua.com, server-cert-fingerprint-sha256=fac26f65c034829da42d740d23c4a7202475a3834f0ebaecae5f934adbbfd640",
    );
    expect(node).toMatchObject({
      type: "anytls",
      sni: "ixigua.com",
      fingerprint: "fac26f65c034829da42d740d23c4a7202475a3834f0ebaecae5f934adbbfd640",
    });
    // 证书锁定指纹不应被当成 uTLS 客户端指纹。
    expect(node?.client_fingerprint).toBeUndefined();
  });

  it("returns empty for [General]-only conf with no proxy lines anywhere", () => {
    // 真正"无代理"的配置,fallback 也找不到合法 proxy 行,应该返回 []。
    expect(parseSurgeConf("[General]\nloglevel = notify\ndns-server = 1.1.1.1")).toEqual([]);
  });

  it("returns empty for plain text that contains no key=value at all", () => {
    expect(parseSurgeConf("just some random text\nno equals here")).toEqual([]);
  });
});

describe("parseSurgeConf - bare proxy lines (no [Proxy] header)", () => {
  // 参考 subconverter explodeSurge:`ini.set_isolated_items_section("Proxy")` 让游离行
  // 自动归入 Proxy 段。本项目用更朴素的实现:无 [Proxy] header 时直接逐行尝试。
  it("parses single bare trojan line (real user input)", () => {
    const text =
      "🇨🇳 Taiwan 04 = trojan, 8dc9ef6261.8c5ecp7fb.sbs, 21409, password=c228a47e-91d1-4a94-8985-4d0ed2b88be0, sni=v-thumb.byteimg.com, skip-cert-verify=true, tfo=true, udp-relay=true";
    const nodes = parseSurgeConf(text);
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({
      type: "trojan",
      name: "🇨🇳 Taiwan 04",
      server: "8dc9ef6261.8c5ecp7fb.sbs",
      port: 21409,
      password: "c228a47e-91d1-4a94-8985-4d0ed2b88be0",
      sni: "v-thumb.byteimg.com",
      skip_cert_verify: true,
      tfo: true,
      udp: true,
      tls: true,
    });
  });

  it("parses multiple bare proxy lines mixed with comments and blank lines", () => {
    const text = `
# leading comment
🇭🇰 HK = trojan, hk.example.com, 443, password=p1, sni=hk.example.com

; another comment style
JP = ss, jp.example.com, 8388, encrypt-method=aes-128-gcm, password=p2
// double-slash comment
TW = vmess, tw.example.com, 443, username=abc-def, ws=true, ws-path=/path
`;
    const nodes = parseSurgeConf(text);
    expect(nodes).toHaveLength(3);
    expect(nodes.map((n) => n.type)).toEqual(["trojan", "ss", "vmess"]);
  });

  it("ignores lines that are not valid surge proxy syntax", () => {
    const text = `
🇨🇳 Taiwan 04 = trojan, t.example.com, 443, password=pw
# 下面的不是 surge 代理行,应被静默忽略
something_random
foo: bar
key=just_a_value
`;
    const nodes = parseSurgeConf(text);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].type).toBe("trojan");
  });

  it("[Proxy] section still takes priority when present (mixed scenario)", () => {
    // 有 [Proxy] 段时,只解析段内,不再 fallback 到游离行。
    const text = `
HEADER = trojan, head.example.com, 443, password=pw1

[Proxy]
INSIDE = trojan, inside.example.com, 443, password=pw2

[Proxy Group]
foo = select, INSIDE
`;
    const nodes = parseSurgeConf(text);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].name).toBe("INSIDE");
  });
});
