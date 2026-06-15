import { describe, expect, it } from "vitest";
import { parseProxyUri } from "../../src/parsers/uri.js";

describe("parseProxyUri", () => {
  it("parses SS SIP002 URI", () => {
    const uri =
      "ss://YWVzLTEyOC1nY206cGFzc3dvcmQ@example.com:8388#%F0%9F%87%AD%F0%9F%87%B0HK01";
    const node = parseProxyUri(uri);
    expect(node).toMatchObject({
      type: "ss",
      server: "example.com",
      port: 8388,
      cipher: "aes-128-gcm",
      password: "password",
      name: "🇭🇰HK01",
    });
  });

  it("parses SS legacy base64 URI", () => {
    const cred = Buffer.from("aes-256-cfb:pwd@example.com:8389").toString("base64");
    const uri = `ss://${cred}#legacy`;
    const node = parseProxyUri(uri);
    expect(node).toMatchObject({
      type: "ss",
      server: "example.com",
      port: 8389,
      cipher: "aes-256-cfb",
      password: "pwd",
    });
  });

  it("parses VMess base64 JSON URI", () => {
    const payload = {
      v: "2",
      ps: "VMess-JP",
      add: "jp.example.com",
      port: "443",
      id: "11111111-2222-3333-4444-555555555555",
      aid: "0",
      net: "ws",
      type: "none",
      host: "jp.example.com",
      path: "/ws",
      tls: "tls",
      scy: "auto",
    };
    const uri = `vmess://${Buffer.from(JSON.stringify(payload)).toString("base64")}`;
    const node = parseProxyUri(uri);
    expect(node).toMatchObject({
      type: "vmess",
      name: "VMess-JP",
      server: "jp.example.com",
      port: 443,
      uuid: "11111111-2222-3333-4444-555555555555",
      tls: true,
      network: "ws",
      ws_opts: { path: "/ws", headers: { Host: "jp.example.com" } },
    });
  });

  it("parses VLESS Reality URI", () => {
    const uri =
      "vless://abcdef00-1234-5678-9abc-def012345678@reality.example.com:443" +
      "?security=reality&type=tcp&flow=xtls-rprx-vision&pbk=PUBKEY&sid=ABCD&fp=chrome&sni=www.cloudflare.com" +
      "#VLESS-Reality";
    const node = parseProxyUri(uri);
    expect(node).toMatchObject({
      type: "vless",
      name: "VLESS-Reality",
      server: "reality.example.com",
      port: 443,
      uuid: "abcdef00-1234-5678-9abc-def012345678",
      tls: true,
      sni: "www.cloudflare.com",
      flow: "xtls-rprx-vision",
      client_fingerprint: "chrome",
      reality_opts: { public_key: "PUBKEY", short_id: "ABCD" },
    });
  });

  it("parses Trojan URI with sni", () => {
    const uri =
      "trojan://trojanpass@gz.example.com:11102?sni=m.ctrip.com&allowInsecure=1#%F0%9F%87%AD%F0%9F%87%B0HK";
    const node = parseProxyUri(uri);
    expect(node).toMatchObject({
      type: "trojan",
      server: "gz.example.com",
      port: 11102,
      password: "trojanpass",
      sni: "m.ctrip.com",
      skip_cert_verify: true,
      tls: true,
    });
  });

  it("parses Hysteria2 URI with obfs", () => {
    const uri =
      "hysteria2://thepass@hy2.example.com:443?obfs=salamander&obfs-password=op&sni=hy2.example.com&insecure=1#HY2";
    const node = parseProxyUri(uri);
    expect(node).toMatchObject({
      type: "hysteria2",
      name: "HY2",
      server: "hy2.example.com",
      port: 443,
      password: "thepass",
      obfs: "salamander",
      obfs_password: "op",
      skip_cert_verify: true,
      tls: true,
      alpn: ["h3"],
    });
  });

  it("parses TUIC v5 URI", () => {
    const uri =
      "tuic://uuid1234-aaaa-bbbb-cccc-dddddddddddd:tpwd@tuic.example.com:443?congestion_control=bbr&alpn=h3#TUIC";
    const node = parseProxyUri(uri);
    expect(node).toMatchObject({
      type: "tuic",
      uuid: "uuid1234-aaaa-bbbb-cccc-dddddddddddd",
      password: "tpwd",
      server: "tuic.example.com",
      port: 443,
      congestion_controller: "bbr",
      alpn: ["h3"],
      tuic_version: 5,
    });
  });

  it("returns null for unknown scheme", () => {
    expect(parseProxyUri("foo://bar")).toBeNull();
    expect(parseProxyUri("")).toBeNull();
  });
});
