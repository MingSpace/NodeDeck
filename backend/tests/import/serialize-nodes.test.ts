import { describe, expect, it } from "vitest";
import { nodesToInlineContent } from "../../src/import/serialize-nodes.js";
import { parseSurgeConf } from "../../src/parsers/surge.js";
import type { Node } from "../../src/schemas/node.js";

// Helper:从 Node 抽核心字段做 round-trip 比较(忽略 generator/parser 各自添加的元数据如 source_provider_id)
function summary(n: Node) {
  return {
    name: n.name,
    type: n.type,
    server: n.server,
    port: n.port,
    password: n.password,
    uuid: n.uuid,
    cipher: n.cipher,
    psk: n.psk,
    sni: n.sni,
    skip_cert_verify: n.skip_cert_verify,
    network: n.network,
    chain_via: n.chain_via,
    ws_opts: n.ws_opts,
  };
}

describe("nodesToInlineContent", () => {
  it("round-trip 出来的节点能被 Surge parser 还原回去(覆盖 sni / ws_opts / chain_via)", () => {
    const input: Node[] = [
      {
        name: "JP-1",
        type: "trojan",
        server: "jp.example.com",
        port: 443,
        password: "p@ss",
        sni: "jp.example.com",
        skip_cert_verify: true,
        tags: [],
      },
      {
        name: "HK-1",
        type: "ss",
        server: "hk.example.com",
        port: 8388,
        password: "secret",
        cipher: "aes-256-gcm",
        tags: [],
      },
      // ws 传输层 + headers 必须在 round-trip 中保留(generator 写 ws=true / ws-path / ws-headers,parser 读回)
      {
        name: "SG-VMess-WS",
        type: "vmess",
        server: "sg.example.com",
        port: 443,
        uuid: "11111111-2222-3333-4444-555555555555",
        cipher: "auto",
        sni: "sg.cdn.example.com",
        network: "ws",
        ws_opts: { path: "/vm", headers: { Host: "sg.cdn.example.com" } },
        tags: [],
      },
      // chain_via 写为 underlying-proxy,parser 读回应该恢复
      {
        name: "Chain-Front",
        type: "ss",
        server: "front.example.com",
        port: 8388,
        cipher: "aes-128-gcm",
        password: "front-pwd",
        tags: [],
      },
      {
        name: "Chain-Back",
        type: "trojan",
        server: "back.example.com",
        port: 443,
        password: "back-pwd",
        sni: "back.example.com",
        chain_via: "Chain-Front",
        tags: [],
      },
    ];

    const { content, warnings } = nodesToInlineContent(input);
    expect(warnings).toEqual([]);
    expect(content.startsWith("[Proxy]\n")).toBe(true);

    const reparsed = parseSurgeConf(content);
    expect(reparsed.map(summary)).toEqual(input.map(summary));
  });

  it("保留 snell 等 Surge 字段", () => {
    const input: Node[] = [
      {
        name: "snell-server",
        type: "snell",
        server: "snell.example.com",
        port: 30000,
        psk: "snellpsk",
        snell_version: 4,
        tags: [],
      },
      {
        name: "trojan-1",
        type: "trojan",
        server: "t.example.com",
        port: 443,
        password: "p1",
        tags: [],
      },
    ];

    const { content, warnings } = nodesToInlineContent(input);
    expect(warnings).toEqual([]);
    expect(content).toMatch(/\[Proxy\]/);
    expect(content).toMatch(/snell-server\s*=\s*snell/);

    const reparsed = parseSurgeConf(content);
    expect(reparsed.find((n) => n.type === "snell")).toBeDefined();
    expect(reparsed.find((n) => n.type === "snell")?.psk).toBe("snellpsk");
  });

  it("snell v6 正常输出(Surge 支持 v1-v6)", () => {
    const input: Node[] = [
      { name: "snell-v6", type: "snell", server: "x.example.com", port: 30000, psk: "k", snell_version: 6, tags: [] },
    ];
    const { content, warnings } = nodesToInlineContent(input);
    expect(warnings).toEqual([]);
    expect(content).toMatch(/^snell-v6 = snell, x\.example\.com, 30000, [^\n]*version=6/m);
  });

  it("Surge 不支持的协议(vless)整节点跳过并 emit warning", () => {
    const input: Node[] = [
      {
        name: "US-Reality",
        type: "vless",
        server: "us.example.com",
        port: 443,
        uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        flow: "xtls-rprx-vision",
        tls: true,
        reality_opts: { public_key: "PUB", short_id: "abcd1234" },
        tags: [],
      },
    ];
    const { content, warnings } = nodesToInlineContent(input);
    expect(content).toBe("[Proxy]\n");
    expect(warnings.some((w) => w.includes("US-Reality"))).toBe(true);
  });
});
