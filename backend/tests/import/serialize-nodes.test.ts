import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { nodesToInlineContent } from "../../src/import/serialize-nodes.js";
import { parseClashYaml } from "../../src/parsers/clash.js";
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
    tls: n.tls,
    skip_cert_verify: n.skip_cert_verify,
    network: n.network,
    flow: n.flow,
    chain_via: n.chain_via,
    ws_opts: n.ws_opts,
    reality_opts: n.reality_opts,
  };
}

describe("nodesToInlineContent", () => {
  it("clash 路径: round-trip 出来的节点能被 parser 还原回去(覆盖 sni / tls / ws_opts / reality_opts / chain_via)", () => {
    const input: Node[] = [
      {
        name: "JP-1",
        type: "trojan",
        server: "jp.example.com",
        port: 443,
        password: "p@ss",
        sni: "jp.example.com",
        tls: true,
        skip_cert_verify: true,
      },
      {
        name: "HK-1",
        type: "ss",
        server: "hk.example.com",
        port: 8388,
        password: "secret",
        cipher: "aes-256-gcm",
      },
      // ws 传输层 + headers 必须在 round-trip 中保留(generator 会写 ws-opts.path/headers,parser 读回)
      {
        name: "SG-VMess-WS",
        type: "vmess",
        server: "sg.example.com",
        port: 443,
        uuid: "11111111-2222-3333-4444-555555555555",
        alter_id: 0,
        cipher: "auto",
        tls: true,
        sni: "sg.cdn.example.com",
        network: "ws",
        ws_opts: { path: "/vm", headers: { Host: "sg.cdn.example.com" } },
      },
      // VLESS Reality:reality_opts.public_key/short_id 嵌套对象,Clash 用 reality-opts: {public-key:...}
      // 故意不写 network: 因为 mihomo 把 tcp 当作默认值,generator 不会输出默认 network 字段,
      // 否则 round-trip 后 network 字段会变成 undefined(语义等价但对象不等)。
      {
        name: "US-Reality",
        type: "vless",
        server: "us.example.com",
        port: 443,
        uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        flow: "xtls-rprx-vision",
        tls: true,
        sni: "www.cloudflare.com",
        reality_opts: { public_key: "PUB", short_id: "abcd1234" },
      },
      // chain_via 在 Clash 端写为 dialer-proxy,parser 读回应该恢复
      {
        name: "Chain-Front",
        type: "ss",
        server: "front.example.com",
        port: 8388,
        cipher: "aes-128-gcm",
        password: "front-pwd",
      },
      {
        name: "Chain-Back",
        type: "trojan",
        server: "back.example.com",
        port: 443,
        password: "back-pwd",
        sni: "back.example.com",
        tls: true,
        chain_via: "Chain-Front",
      },
    ];

    const { content, warnings } = nodesToInlineContent(input, "clash");
    expect(warnings).toEqual([]);

    // 内容应该是合法 yaml,顶层有 proxies
    const parsedYaml = yaml.load(content) as { proxies: unknown[] };
    expect(Array.isArray(parsedYaml.proxies)).toBe(true);

    const reparsed = parseClashYaml(content);
    expect(reparsed.map(summary)).toEqual(input.map(summary));
  });

  it("surge 路径: 保留 snell 等 Surge-only 字段", () => {
    const input: Node[] = [
      {
        name: "snell-server",
        type: "snell",
        server: "snell.example.com",
        port: 30000,
        psk: "snellpsk",
        snell_version: 4,
      },
      {
        name: "trojan-1",
        type: "trojan",
        server: "t.example.com",
        port: 443,
        password: "p1",
      },
    ];

    const { content, warnings } = nodesToInlineContent(input, "surge");
    expect(warnings).toEqual([]);
    expect(content).toMatch(/\[Proxy\]/);
    expect(content).toMatch(/snell-server\s*=\s*snell/);

    const reparsed = parseSurgeConf(content);
    expect(reparsed.find((n) => n.type === "snell")).toBeDefined();
    expect(reparsed.find((n) => n.type === "snell")?.psk).toBe("snellpsk");
  });

  it("clash 路径: snell 会被 generator 跳过并 emit warning(Clash 不支持 snell)", () => {
    const input: Node[] = [
      {
        name: "snell-x",
        type: "snell",
        server: "x.example.com",
        port: 30000,
        psk: "k",
      },
    ];
    const { content, warnings } = nodesToInlineContent(input, "clash");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/snell/);
    // 没有任何 proxies(content 仍合法)
    const parsedYaml = yaml.load(content) as { proxies: unknown[] };
    expect(parsedYaml.proxies.length).toBe(0);
  });
});
