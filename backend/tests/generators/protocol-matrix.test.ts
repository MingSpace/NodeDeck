import { describe, expect, it } from "vitest";
import { generateClashConfig } from "../../src/generators/clash.js";
import { generateSurgeConfig } from "../../src/generators/surge.js";
import { emptyProfile, protocolFixtures } from "./__fixtures__/protocol-matrix.js";
import type { Node } from "../../src/schemas/node.js";
import type { ProxyGroup } from "../../src/schemas/proxy-group.js";
import { providerSchema, type Provider } from "../../src/schemas/provider.js";

function makeProvider(id: string, name: string, tags: string[] = []): Provider {
  return providerSchema.parse({ id, name, type: "http", url: "https://example.com/sub", tags });
}

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

  it("重名节点(无 provider 信息)回退 #2 后缀,warning 一致", () => {
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

  it("跨 provider 重名 → 所有撞名节点加来源首字母前缀(两端一致)", () => {
    const providers = [makeProvider("kona", "Kona"), makeProvider("apex", "Apex")];
    const nodes: Node[] = [
      { name: "Hong Kong 01", type: "ss", server: "a.example.com", port: 8388, cipher: "aes-128-gcm", password: "p1", source_provider_id: "kona", tags: [] },
      { name: "Hong Kong 01", type: "trojan", server: "b.example.com", port: 443, password: "p2", tls: true, source_provider_id: "apex", tags: [] },
      { name: "Tokyo 01", type: "ss", server: "c.example.com", port: 8388, cipher: "aes-128-gcm", password: "p3", source_provider_id: "kona", tags: [] },
    ];
    const warnings: string[] = [];
    const clash = generateClashConfig({ profile: emptyProfile(), nodes, providers, groups: [], rules: [], warnings });
    expect(clash).toContain("【K】Hong Kong 01");
    expect(clash).toContain("【A】Hong Kong 01");
    expect(clash).not.toMatch(/name: Hong Kong 01\n/);
    // 不撞名的节点不加前缀
    expect(clash).toContain("name: Tokyo 01");
    expect(clash).not.toContain("【K】Tokyo 01");
    expect(warnings.filter((w) => w.includes("renamed to")).length).toBe(2);

    const surge = generateSurgeConfig({ profile: emptyProfile(), nodes, providers, groups: [], rules: [], surgeModules: [], warnings: [] });
    expect(surge).toMatch(/^【K】Hong Kong 01 = ss,/m);
    expect(surge).toMatch(/^【A】Hong Kong 01 = trojan,/m);
    expect(surge).toMatch(/^Tokyo 01 = ss,/m);
  });

  it("provider 有 tag → 前缀用第一个 tag 的完整文本", () => {
    const providers = [makeProvider("kona", "Kona", ["主力", "高速"]), makeProvider("apex", "Apex")];
    const nodes: Node[] = [
      { name: "Hong Kong 01", type: "ss", server: "a.example.com", port: 8388, cipher: "aes-128-gcm", password: "p1", source_provider_id: "kona", tags: [] },
      { name: "Hong Kong 01", type: "trojan", server: "b.example.com", port: 443, password: "p2", tls: true, source_provider_id: "apex", tags: [] },
    ];
    const out = generateClashConfig({ profile: emptyProfile(), nodes, providers, groups: [], rules: [], warnings: [] });
    expect(out).toContain("【主力】Hong Kong 01");
    expect(out).toContain("【A】Hong Kong 01");
  });

  it("加前缀后仍撞名(同一 provider 内同名)→ 继续追加 #2 兜底", () => {
    const providers = [makeProvider("kona", "Kona")];
    const nodes: Node[] = [
      { name: "Hong Kong 01", type: "ss", server: "a.example.com", port: 8388, cipher: "aes-128-gcm", password: "p1", source_provider_id: "kona", tags: [] },
      { name: "Hong Kong 01", type: "trojan", server: "b.example.com", port: 443, password: "p2", tls: true, source_provider_id: "kona", tags: [] },
    ];
    const out = generateClashConfig({ profile: emptyProfile(), nodes, providers, groups: [], rules: [], warnings: [] });
    expect(out).toContain("【K】Hong Kong 01");
    expect(out).toContain("【K】Hong Kong 01 #2");
  });

  it("group.proxies 显式引用撞名原名 → 原位展开为全部同名节点的新名", () => {
    const providers = [makeProvider("kona", "Kona"), makeProvider("apex", "Apex")];
    const nodes: Node[] = [
      { name: "Hong Kong 01", type: "ss", server: "a.example.com", port: 8388, cipher: "aes-128-gcm", password: "p1", source_provider_id: "kona", tags: [] },
      { name: "Hong Kong 01", type: "trojan", server: "b.example.com", port: 443, password: "p2", tls: true, source_provider_id: "apex", tags: [] },
    ];
    const groups: ProxyGroup[] = [
      { id: "Manual", name: "Manual", type: "select", proxies: ["Hong Kong 01", "DIRECT"], nested_groups: [] },
    ];
    const warnings: string[] = [];
    const clash = generateClashConfig({ profile: emptyProfile(), nodes, providers, groups, rules: [], warnings });
    expect(clash).toContain("proxies: [【K】Hong Kong 01, 【A】Hong Kong 01, DIRECT]");
    // 引用被展开,不应触发悬空剔除 warning
    expect(warnings.some((w) => w.includes("not found") && w.includes("Hong Kong 01"))).toBe(false);

    const surge = generateSurgeConfig({ profile: emptyProfile(), nodes, providers, groups, rules: [], surgeModules: [], warnings: [] });
    expect(surge).toMatch(/^Manual = select,【K】Hong Kong 01,【A】Hong Kong 01,DIRECT/m);
  });

  it("group.proxies 引用撞名原名(无 provider 标识,#2 兜底)→ 展开为 [原名, 原名 #2]", () => {
    const nodes: Node[] = [
      { name: "Hong Kong 01", type: "ss", server: "a.example.com", port: 8388, cipher: "aes-128-gcm", password: "p1", tags: [] },
      { name: "Hong Kong 01", type: "trojan", server: "b.example.com", port: 443, password: "p2", tls: true, tags: [] },
    ];
    const groups: ProxyGroup[] = [
      { id: "Manual", name: "Manual", type: "select", proxies: ["Hong Kong 01", "DIRECT"], nested_groups: [] },
    ];
    const clash = generateClashConfig({ profile: emptyProfile(), nodes, groups, rules: [], warnings: [] });
    // yaml 中 ` #` 开启注释,js-yaml 会给含 # 的名字加单引号
    expect(clash).toContain("proxies: [Hong Kong 01, 'Hong Kong 01 #2', DIRECT]");

    const surge = generateSurgeConfig({ profile: emptyProfile(), nodes, groups, rules: [], surgeModules: [], warnings: [] });
    expect(surge).toMatch(/^Manual = select,Hong Kong 01,Hong Kong 01 #2,DIRECT/m);
  });

  it("chain_via 引用撞名原名 → 仍指向第一个同名节点(单值语义)", () => {
    const providers = [makeProvider("kona", "Kona"), makeProvider("apex", "Apex")];
    const nodes: Node[] = [
      { name: "Landing", type: "ss", server: "a.example.com", port: 8388, cipher: "aes-128-gcm", password: "p1", source_provider_id: "kona", tags: [] },
      { name: "Landing", type: "ss", server: "b.example.com", port: 8388, cipher: "aes-128-gcm", password: "p2", source_provider_id: "apex", tags: [] },
      { name: "Front", type: "trojan", server: "c.example.com", port: 443, password: "p3", tls: true, chain_via: "Landing", tags: [] },
    ];
    const clash = generateClashConfig({ profile: emptyProfile(), nodes, providers, groups: [], rules: [], warnings: [] });
    expect(clash).toContain("dialer-proxy: 【K】Landing");
    expect(clash).not.toContain("dialer-proxy: 【A】Landing");
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

  // Surge 5 wireguard 必须用 section-name 模式(参见 manual.nssurge.com/policy/wireguard.html)。
  // 这里直接断言关键结构字段,避免完全依赖 snapshot 的脆弱性 — 即使 snapshot 丢失也能锁住格式契约。
  it("Surge wireguard 输出 section-name + [WireGuard <id>] 段 + peer = (...)", () => {
    const node: Node = {
      name: "WG-Test",
      type: "wireguard",
      server: "wg.example.com",
      port: 51820,
      private_key: "PRIV-KEY",
      public_key: "PUB-KEY",
      preshared_key: "PSK",
      ip: "10.0.0.2/32",
      mtu: 1280,
      tags: [],
    };
    const surge = generateSurgeConfig({
      profile: emptyProfile(),
      nodes: [node],
      groups: [],
      rules: [],
      surgeModules: [],
      warnings: [],
    });
    // [Proxy] 行只引用 section name,不再 inline private-key 等敏感字段
    expect(surge).toMatch(/^WG-Test = wireguard, section-name=WG-Test$/m);
    expect(surge).not.toMatch(/^WG-Test = wireguard, wg\.example\.com,/m);
    // [WireGuard WG-Test] 段必含 private-key / self-ip / peer = (...)
    expect(surge).toContain("[WireGuard WG-Test]");
    expect(surge).toContain("private-key = PRIV-KEY");
    expect(surge).toContain("self-ip = 10.0.0.2/32");
    expect(surge).toContain("mtu = 1280");
    expect(surge).toMatch(
      /peer = \(public-key = PUB-KEY, preshared-key = PSK, allowed-ips = "0\.0\.0\.0\/0, ::\/0", endpoint = wg\.example\.com:51820\)/,
    );
  });

  it("Surge wireguard 节点名含 emoji/空格 → section id 自动 sanitize 成 ASCII", () => {
    const node: Node = {
      name: "🛡 我的 WARP 节点",
      type: "wireguard",
      server: "wg.example.com",
      port: 2408,
      private_key: "PK",
      public_key: "PUB",
      ip: "172.16.0.2/32",
      tags: [],
    };
    const surge = generateSurgeConfig({
      profile: emptyProfile(),
      nodes: [node],
      groups: [],
      rules: [],
      surgeModules: [],
      warnings: [],
    });
    // section-name 必须是 ASCII 安全 token,但 [Proxy] 行的节点名(=左侧)保持原样
    expect(surge).toMatch(/^🛡 我的 WARP 节点 = wireguard, section-name=[A-Za-z0-9_-]+$/m);
    // 段头与 [Proxy] 行的 section id 必须一致
    const m = surge.match(/section-name=([A-Za-z0-9_-]+)/);
    expect(m).not.toBeNull();
    const sid = m![1];
    expect(surge).toContain(`[WireGuard ${sid}]`);
  });

  it("Surge hysteria2 不输出 upload-bandwidth(Surge 5 不支持)", () => {
    const node: Node = {
      name: "HY2",
      type: "hysteria2",
      server: "hy2.example.com",
      port: 443,
      password: "pw",
      up: "100 Mbps",
      down: "500 Mbps",
      tls: true,
      tags: [],
    };
    const surge = generateSurgeConfig({
      profile: emptyProfile(),
      nodes: [node],
      groups: [],
      rules: [],
      surgeModules: [],
      warnings: [],
    });
    expect(surge).toContain("download-bandwidth=500");
    expect(surge).not.toContain("upload-bandwidth");
  });

  it("Surge tuic v5 必须显式输出 version=5 字段", () => {
    const node: Node = {
      name: "TUIC",
      type: "tuic",
      server: "tuic.example.com",
      port: 443,
      uuid: "11111111-2222-3333-4444-555555555555",
      password: "pw",
      tuic_version: 5,
      tls: true,
      tags: [],
    };
    const surge = generateSurgeConfig({
      profile: emptyProfile(),
      nodes: [node],
      groups: [],
      rules: [],
      surgeModules: [],
      warnings: [],
    });
    expect(surge).toContain("version=5");
    expect(surge).toContain("uuid=11111111-2222-3333-4444-555555555555");
    expect(surge).toContain("password=pw");
  });

  it("Surge wireguard 节点带 chain_via 时发 warning(Surge 不支持 wg 叠 underlying-proxy)", () => {
    const node: Node = {
      name: "WG-Chained",
      type: "wireguard",
      server: "wg.example.com",
      port: 51820,
      private_key: "PK",
      public_key: "PUB",
      ip: "10.0.0.2/32",
      chain_via: "Some-Front",
      tags: [],
    };
    const warnings: string[] = [];
    const surge = generateSurgeConfig({
      profile: emptyProfile(),
      nodes: [node],
      groups: [],
      rules: [],
      surgeModules: [],
      warnings,
    });
    expect(warnings.some((w) => w.includes("WG-Chained") && w.includes("chain_via"))).toBe(true);
    // 即使发了 warning,wireguard 节点本身仍然要正常输出
    expect(surge).toContain("section-name=WG-Chained");
    expect(surge).toContain("[WireGuard WG-Chained]");
  });
});
