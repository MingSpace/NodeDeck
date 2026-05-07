import { describe, expect, it } from "vitest";
import { parseSubscription } from "../../src/parsers/index.js";
import { dedupeNodes } from "../../src/parsers/dedup.js";
import { annotateNodes } from "../../src/parsers/normalize.js";

describe("parseSubscription auto-detect", () => {
  it("detects clash yaml", () => {
    const out = parseSubscription(`proxies:\n  - {name: a, type: trojan, server: s.com, port: 443, password: pw}`);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("trojan");
  });

  it("detects surge ini", () => {
    const out = parseSubscription(`[General]\n\n[Proxy]\nA = trojan, s.com, 443, password=pw`);
    expect(out).toHaveLength(1);
  });

  it("detects v2ray base64", () => {
    const ssLine = "ss://YWVzLTEyOC1nY206cHdk@example.com:8388#A";
    const b64 = Buffer.from(ssLine).toString("base64");
    const out = parseSubscription(b64);
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("ss");
  });

  it("detects plain uri list", () => {
    const text = `ss://YWVzLTEyOC1nY206cHdk@a.com:8388#A\ntrojan://pw@b.com:443?sni=x.com#B`;
    const out = parseSubscription(text);
    expect(out).toHaveLength(2);
  });

  it("detects bare surge proxy line (no [Proxy] header) — single trojan", () => {
    // 这是用户最常见的"测试单节点"场景:直接粘一行 Surge 风格代理。
    const text =
      "🇨🇳 Taiwan 04 = trojan, 8dc9ef6261.8c5ecp7fb.sbs, 21409, password=c228a47e-91d1-4a94-8985-4d0ed2b88be0, sni=v-thumb.byteimg.com, skip-cert-verify=true, tfo=true, udp-relay=true";
    const out = parseSubscription(text);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: "trojan", name: "🇨🇳 Taiwan 04", port: 21409 });
  });

  it("detects bare surge proxy lines — multiple types (ss/trojan/vmess)", () => {
    const text = `
HK = trojan, hk.example.com, 443, password=p1
JP = ss, jp.example.com, 8388, encrypt-method=aes-128-gcm, password=p2
TW = vmess, tw.example.com, 443, username=11111111-2222-3333-4444-555555555555
`;
    const out = parseSubscription(text);
    expect(out.map((n) => n.type)).toEqual(["trojan", "ss", "vmess"]);
  });

  it("does not falsely match yaml-only content as bare surge", () => {
    // 没 proxies: 段的 yaml,不应该误识别为 surge。
    const text = `dns: 8.8.8.8\ntimeout: 5`;
    const out = parseSubscription(text);
    expect(out).toEqual([]);
  });
});

describe("parseSubscription mixed hint (Sub-Store-style line dispatcher)", () => {
  it("parses URI + Surge 行 mixed in one text", () => {
    const text = `ss://YWVzLTEyOC1nY206cHdk@a.com:8388#A
HK = trojan, hk.example.com, 443, password=pw
trojan://pwx@b.com:443?sni=x.com#B`;
    const out = parseSubscription(text, "mixed");
    expect(out).toHaveLength(3);
    const names = out.map((n) => n.name);
    expect(names).toEqual(expect.arrayContaining(["A", "HK", "B"]));
  });

  it("ignores blank lines and comments", () => {
    const text = `
# comment
HK = trojan, hk.example.com, 443, password=pw

; another comment
ss://YWVzLTEyOC1nY206cHdk@a.com:8388#A
`;
    const out = parseSubscription(text, "mixed");
    expect(out).toHaveLength(2);
  });

  it("silently skips unparseable lines", () => {
    const text = `random garbage line
HK = trojan, hk.example.com, 443, password=pw
yet another line that is not a node`;
    const out = parseSubscription(text, "mixed");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("trojan");
  });
});

describe("dedupeNodes", () => {
  it("dedupes by type+server+port+secret", () => {
    const nodes = parseSubscription(
      `proxies:\n  - {name: A, type: ss, server: s.com, port: 8388, cipher: aes-128-gcm, password: pwd}\n  - {name: B, type: ss, server: s.com, port: 8388, cipher: aes-128-gcm, password: pwd}`,
    );
    const out = dedupeNodes(nodes);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("A");
  });
});

describe("annotateNodes", () => {
  it("detects HK from emoji and JP from keyword", () => {
    const nodes = annotateNodes([
      { type: "ss", name: "🇭🇰 香港 IEPL 标准", server: "s", port: 1, cipher: "x", password: "x", tags: [] },
      { type: "ss", name: "Japan-Premium", server: "s", port: 2, cipher: "x", password: "x", tags: [] },
    ]);
    expect(nodes[0].region).toBe("HK");
    expect(nodes[0].line).toBe("IEPL");
    expect(nodes[1].region).toBe("JP");
    expect(nodes[1].level).toBe("premium");
  });
});
