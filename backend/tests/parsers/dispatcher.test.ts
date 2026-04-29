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
