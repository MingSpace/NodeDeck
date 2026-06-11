import { describe, expect, it } from "vitest";
import {
  isInfoNode,
  filterInfoNodes,
  filterInfoNodesWithReport,
} from "../../src/parsers/info-node-filter.js";
import { parseSubscription } from "../../src/parsers/index.js";
import type { Node } from "../../src/schemas/node.js";

function trojan(name: string): Node {
  return {
    type: "trojan",
    name,
    server: "s.example.com",
    port: 443,
    password: "pw",
    tags: [],
  } as Node;
}

describe("isInfoNode", () => {
  describe("典型信息节点(应识别为 info,过滤掉)", () => {
    const POSITIVE_NAMES = [
      // 流量类
      "Traffic: 59.17 GB | 150 GB",
      "Traffic：100GB / 200GB",
      "剩余流量: 59.17 GB",
      "本月流量:100GB",
      "已用流量 - 12.3 GB",
      "总流量│150 GB",
      "Traffic | 12.3 GB / 150 GB",
      // 到期类
      "Expire: 2027-05-02",
      "Expires：2027-05-02",
      "到期:2027-05-02",
      "过期时间│2027-05-02",
      "有效期 - 2027-05-02",
      "Valid Until: 2027-05-02",
      // 重置类
      "距离下次重置剩余:25 天",
      "下次重置: 2026-06-01",
      "Reset In: 25 days",
      "流量重置日 - 1 号",
      "Traffic Reset： 19 Days Left", // "Traffic" 后跟 "Reset" 而非分隔符,需要组合关键字才能命中
      "Traffic Reset: 19 Days Left",
      // 公告 / 套餐
      "公告:本周维护",
      "📢 公告:本周维护",
      "通知 - 服务变更",
      "Notice: maintenance",
      "套餐到期: 2027-05-02",
      "当前套餐:Premium",
      // 官网 / TG
      "官网: https://example.com",
      "官方网站│https://example.com",
      "访问官网 - https://example.com",
      "公众号:某某机场",
      // URL 作 name
      "https://example.com/dashboard",
      "  https://example.com  ",
      "t.me/example_group",
      "tg://join?invite=xxx",
      "@example_official",
    ];

    for (const name of POSITIVE_NAMES) {
      it(`过滤: ${JSON.stringify(name)}`, () => {
        expect(isInfoNode({ name })).toBe(true);
      });
    }
  });

  describe("正常节点(不能误伤)", () => {
    const NEGATIVE_NAMES = [
      "🇭🇰 香港 IEPL 专线 1",
      "🇯🇵 日本实验性 IEPL 专线 1",
      "🇨🇳 Taiwan 04",
      "HK-Premium-01",
      "Japan-Standard",
      "🇯🇵 日本-Traffic-Plus", // 包含 Traffic 但不是前缀模式
      "重置版 香港 01", // 包含"重置"但不是"距离下次重置/下次重置/Reset In"
      "Plan B 备用线路", // 包含 Plan 但没有跟分隔符
      "🇸🇬 新加坡-到期备用-01", // 包含"到期"但不是前缀
      "expired-policy-test", // expire 词根但不是前缀+分隔符语义
      "Notice-Premium-01", // Notice 词但不是前缀+分隔符
      "🇺🇸 美国 Website Lab 01", // Website 在中间,且没有分隔符
    ];

    for (const name of NEGATIVE_NAMES) {
      it(`保留: ${JSON.stringify(name)}`, () => {
        expect(isInfoNode({ name })).toBe(false);
      });
    }
  });

  it("空 name 视为非 info(保守不过滤)", () => {
    expect(isInfoNode({ name: "" })).toBe(false);
  });
});

describe("filterInfoNodes", () => {
  it("过滤掉 Traffic / Expire,保留真节点", () => {
    const nodes = [
      trojan("Traffic: 59.17 GB | 150 GB"),
      trojan("Expire: 2027-05-02"),
      trojan("🇭🇰 香港 IEPL 专线 1"),
      trojan("🇯🇵 日本实验性 IEPL 专线 1"),
    ];
    const kept = filterInfoNodes(nodes);
    expect(kept.map((n) => n.name)).toEqual([
      "🇭🇰 香港 IEPL 专线 1",
      "🇯🇵 日本实验性 IEPL 专线 1",
    ]);
  });

  it("无信息节点时原样返回(数组等价但不一定同引用)", () => {
    const nodes = [trojan("🇭🇰 香港 01"), trojan("🇯🇵 日本 01")];
    expect(filterInfoNodes(nodes)).toEqual(nodes);
  });

  it("filterInfoNodesWithReport 把过滤掉的也单独报出来", () => {
    const nodes = [
      trojan("Traffic: 100 GB"),
      trojan("🇭🇰 香港 01"),
      trojan("Expire: 2027-05-02"),
    ];
    const { kept, dropped } = filterInfoNodesWithReport(nodes);
    expect(kept.map((n) => n.name)).toEqual(["🇭🇰 香港 01"]);
    expect(dropped.map((n) => n.name)).toEqual([
      "Traffic: 100 GB",
      "Expire: 2027-05-02",
    ]);
  });
});

describe("parseSubscription 出口集成", () => {
  it("Clash yaml:Traffic/Expire 伪节点被自动剔除", () => {
    // 真实场景:三条节点共用同一 server/port/password,前两条是机场伪装的信息节点。
    // 若不过滤,经过下游 dedupeNodes 后会只剩 Traffic 那条(keep-first),把真节点挤掉。
    const text = `proxies:
  - {name: "Traffic: 59.17 GB | 150 GB", type: trojan, server: s.com, port: 443, password: pw}
  - {name: "Expire: 2027-05-02", type: trojan, server: s.com, port: 443, password: pw}
  - {name: "🇭🇰 香港 IEPL 专线 1", type: trojan, server: s.com, port: 443, password: pw}`;
    const out = parseSubscription(text);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("🇭🇰 香港 IEPL 专线 1");
  });

  it("Surge ini:信息节点同样被剔除", () => {
    const text = `[Proxy]
Traffic: 59.17 GB | 150 GB = trojan, s.com, 443, password=pw
Expire: 2027-05-02 = trojan, s.com, 443, password=pw
🇭🇰 香港 IEPL 专线 1 = trojan, s.com, 443, password=pw`;
    const out = parseSubscription(text);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("🇭🇰 香港 IEPL 专线 1");
  });

  it("URI list:URL 作为节点 name 的伪节点被剔除", () => {
    // ss URI fragment 是 name。`#` 后面的部分是节点名。
    const realSs = "ss://YWVzLTEyOC1nY206cHdk@a.com:8388#%F0%9F%87%AD%F0%9F%87%B0%20%E9%A6%99%E6%B8%AF";
    const adSs = "ss://YWVzLTEyOC1nY206cHdk@b.com:8388#https%3A%2F%2Fexample.com";
    const out = parseSubscription([realSs, adSs].join("\n"));
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("🇭🇰 香港");
  });
});
