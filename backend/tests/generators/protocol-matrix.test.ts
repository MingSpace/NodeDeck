import { describe, expect, it } from "vitest";
import { generateClashConfig } from "../../src/generators/clash.js";
import { generateSurgeConfig } from "../../src/generators/surge.js";
import { emptyProfile, protocolFixtures } from "./__fixtures__/protocol-matrix.js";
import type { Node } from "../../src/schemas/node.js";

function normalize(text: string): string {
  return text.replace(/Generated at: [^\n]+/g, "Generated at: [TIMESTAMP]");
}

describe("protocol matrix snapshot", () => {
  for (const fx of protocolFixtures) {
    it(`${fx.name} → clash`, () => {
      const out = generateClashConfig({
        profile: emptyProfile(),
        nodes: [fx.node],
        groups: [],
        rules: [],
        warnings: [],
      });
      expect(normalize(out)).toMatchSnapshot();
    });
    it(`${fx.name} → surge`, () => {
      const out = generateSurgeConfig({
        profile: emptyProfile(),
        nodes: [fx.node],
        groups: [],
        rules: [],
        surgeModules: [],
        warnings: [],
      });
      expect(normalize(out)).toMatchSnapshot();
    });
  }

  it("chain_via 在两端正确转换为 dialer-proxy / underlying-proxy", () => {
    const nodes: Node[] = [
      {
        name: "WARP",
        type: "wireguard",
        server: "wg.example.com",
        port: 2408,
        private_key: "PK",
        public_key: "PUB",
        ip: "172.16.0.2/32",
        tags: [],
      },
      {
        name: "🇭🇰 HK-Chain",
        type: "trojan",
        server: "hk.example.com",
        port: 443,
        password: "x",
        sni: "x.example.com",
        tls: true,
        chain_via: "WARP",
        tags: [],
      },
    ];
    const clash = generateClashConfig({
      profile: emptyProfile(),
      nodes,
      groups: [],
      rules: [],
      warnings: [],
    });
    const surge = generateSurgeConfig({
      profile: emptyProfile(),
      nodes,
      groups: [],
      rules: [],
      surgeModules: [],
      warnings: [],
    });
    expect(clash).toMatch(/dialer-proxy: WARP/);
    expect(surge).toMatch(/underlying-proxy=WARP/);
  });

  it("重名节点自动加 #2 后缀,warning 一致", () => {
    const nodes: Node[] = [
      { name: "🇭🇰 HK-01", type: "ss", server: "a.example.com", port: 8388, cipher: "aes-128-gcm", password: "p1", tags: [] },
      { name: "🇭🇰 HK-01", type: "trojan", server: "b.example.com", port: 443, password: "p2", tls: true, tags: [] },
      { name: "🇭🇰 HK-01", type: "vmess", server: "c.example.com", port: 443, uuid: "11111111-2222-3333-4444-555555555555", tags: [] },
    ];
    const warnings: string[] = [];
    const out = generateClashConfig({
      profile: emptyProfile(),
      nodes,
      groups: [],
      rules: [],
      warnings,
    });
    expect(out).toContain("🇭🇰 HK-01");
    expect(out).toContain("🇭🇰 HK-01 #2");
    expect(out).toContain("🇭🇰 HK-01 #3");
    expect(warnings.filter((w) => w.includes("renamed to")).length).toBe(2);
  });

  it("chain_via 指向不存在节点 → 降级 + warning", () => {
    const nodes: Node[] = [
      {
        name: "🇯🇵 JP-Sole",
        type: "ss",
        server: "jp.example.com",
        port: 8388,
        cipher: "aes-128-gcm",
        password: "p",
        chain_via: "GhostNode",
        tags: [],
      },
    ];
    const warnings: string[] = [];
    const out = generateClashConfig({
      profile: emptyProfile(),
      nodes,
      groups: [],
      rules: [],
      warnings,
    });
    expect(out).not.toMatch(/dialer-proxy:/);
    expect(warnings.some((w) => w.includes("Chain dangling") && w.includes("GhostNode"))).toBe(true);
  });
});
