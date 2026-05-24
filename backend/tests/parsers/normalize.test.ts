import { describe, expect, it } from "vitest";
import { annotateNode } from "../../src/parsers/normalize.js";
import type { Node } from "../../src/schemas/node.js";

function n(name: string): Node {
  return { name, type: "ss", server: "s.com", port: 443, tags: [] };
}

// @intent 该测试主要任务是给"region 识别表"加 safety net。表的实现细节(REGION_FLAGS 顺序、
// 单 pattern 还是多 pattern)可以重构,但下面的契约不能破:
//   1. 国旗 emoji 永远优先识别 -> ISO alpha-2
//   2. 双字母国家码必须**词边界**匹配,不能被 "smart"/"limit"/"beijing"/"trust" 等含子串的英文单词触发
//   3. 中文国名/常见城市/拼音都能识别
//   4. 一些已知的"alpha-2 = 高频英文词"地区(BE/AT/NO/IS/IT/GB) 已经放弃 alpha-2 形式,
//      只用 alpha-3,避免 "be"/"at"/"no"/"is"/"it"/"gb" 单词误判
//   5. 完全没有地区信息的节点 region = undefined,不会瞎填
describe("annotateNode - region detection", () => {
  describe("emoji flag (always wins)", () => {
    it.each([
      ["🇭🇰 香港 IEPL", "HK"],
      ["🇯🇵 Tokyo 01", "JP"],
      ["🇺🇸 USA-LA-01", "US"],
      ["🇨🇳 上海 BGP", "CN"],
      ["🇲🇴 澳门 CTM", "MO"],
      ["🇰🇷 Seoul Premium", "KR"],
      ["🇸🇬 Singapore", "SG"],
      ["🇹🇼 Taiwan 01", "TW"],
      ["🇩🇪 Frankfurt", "DE"],
      ["🇬🇧 London", "GB"],
      ["🇸🇪 Stockholm", "SE"],
      ["🇳🇴 Oslo", "NO"],
      ["🇵🇱 Warsaw", "PL"],
      ["🇦🇹 Vienna", "AT"],
      ["🇧🇪 Brussels", "BE"],
      ["🇮🇸 Reykjavik", "IS"],
      ["🇮🇹 Milan", "IT"],
    ])("%s → %s", (name, code) => {
      expect(annotateNode(n(name)).region).toBe(code);
    });
  });

  describe("ISO alpha-2 with word boundary", () => {
    it.each([
      ["JP-Tokyo-01", "JP"],
      ["JP01", "JP"], // 数字直接拼接也能匹配
      ["JPN-Premium", "JP"], // alpha-3 也覆盖
      ["HK-01", "HK"],
      ["HKG-01", "HK"],
      ["US-LA-01", "US"],
      ["USA-NY-02", "US"],
      ["SG-01", "SG"],
      ["TW-Taipei", "TW"],
      ["KR-Seoul", "KR"],
      ["MO-01", "MO"],
      ["CA-Toronto", "CA"],
      ["DE-Frankfurt", "DE"],
      ["FR-Paris", "FR"],
      ["NL-Amsterdam", "NL"],
      ["AU-Sydney", "AU"],
      ["CN01", "CN"], // \bCN\d+\b
    ])("%s → %s", (name, code) => {
      expect(annotateNode(n(name)).region).toBe(code);
    });
  });

  describe("Chinese city / pinyin / full name", () => {
    it.each([
      ["日本-东京-01", "JP"],
      ["日本-大阪-Premium", "JP"],
      ["京都-高级线路", "JP"],
      ["Tokyo-Yokohama-Direct", "JP"],
      ["Osaka-IEPL", "JP"],
      ["Sapporo-Cloud", "JP"],
      ["香港-九龙-01", "HK"],
      ["kowloon-direct", "HK"],
      ["新加坡-高级", "SG"],
      ["狮城-IPLC", "SG"],
      ["首尔-Seoul-01", "KR"],
      ["釜山-Busan-Cloud", "KR"],
      ["台北-Taipei-Premium", "TW"],
      ["高雄-Kaohsiung", "TW"],
      ["北京-BGP", "CN"],
      ["上海-IPLC", "CN"],
      ["广州-CDN", "CN"],
      ["深圳-移动", "CN"],
      ["杭州-阿里云", "CN"],
      ["成都-Premium", "CN"],
      ["武汉-标准", "CN"],
      ["苏州-中转", "CN"],
      ["回国线路-Shanghai", "CN"],
      ["纽约-Direct", "US"],
      ["洛杉矶-Premium", "US"],
      ["硅谷-高级", "US"],
      ["西雅图-IPLC", "US"],
      ["芝加哥-BGP", "US"],
      ["伦敦-London-01", "GB"],
      ["法兰克福-Direct", "DE"],
      ["柏林-Berlin", "DE"],
      ["巴黎-Paris", "FR"],
      ["澳门-CTM-Premium", "MO"],
      ["迪拜-高级", "AE"],
    ])("%s → %s", (name, code) => {
      expect(annotateNode(n(name)).region).toBe(code);
    });
  });

  describe("ISP / 接入点缩写", () => {
    it.each([
      ["HKT-Premium", "HK"],
      ["HKBN-Direct", "HK"],
      ["HGC-IPLC", "HK"],
      ["WTT-BGP", "HK"],
      ["CMI-Cloud", "HK"],
      ["CHT-Hinet-01", "TW"],
      ["HINET-Premium", "TW"],
      ["CTM-Macau", "MO"],
    ])("%s → %s", (name, code) => {
      expect(annotateNode(n(name)).region).toBe(code);
    });
  });

  describe("反测试:常见英文单词不应被误判为地区(防止子串误命中)", () => {
    // 早期实现用 name.includes("ar") 等裸子串匹配,导致 "smart" → AR,"beijing" → IN,
    // "limit" → IT,"trust" → TR 等大量误判。修复后这些都应为 undefined(或匹配其他正确地区)。
    it.each([
      // 含 "ar" 不该误判为 AR (阿根廷)
      ["smart-route-edge", undefined],
      ["sm-art-line", undefined],
      ["market-guard", undefined],
      ["search-fast", undefined], // 含 "ar" "ch" 都不该误判
      // 含 "in" 不该误判为 IN (印度) — beijing 应识别为 CN
      ["beijing-line", "CN"], // 包含"北京"-> CN, 不是 IN
      ["linux-server", undefined], // 含 in,不该是 IN
      ["online-edge", undefined],
      ["spin-test", undefined],
      // 含 "it" 不该误判为 IT (意大利) — IT 已改用 alpha-3 only
      ["limit-traffic", undefined],
      ["edit-config", undefined],
      ["visit-server", undefined],
      ["unit-test", undefined],
      ["it-just-works", undefined], // 句子里的 "it"
      // 含 "tr" 不该误判为 TR (土耳其) — \bTR 词边界保护
      ["trust-route", undefined],
      ["structure-edge", undefined],
      ["stream-fast", undefined],
      // 含 "ch" 不该误判为 CH (瑞士)
      ["search-fast-edge", undefined],
      ["match-route", undefined],
      ["touch-line", undefined],
      // 含 "ph" 不该误判为 PH (菲律宾) — 但 \bPH\d+\b 严格了所以也安全
      ["phone-fast", undefined],
      ["graph-edge", undefined],
      // 含 "il" 不该误判为 IL — \bIL\d+\b 严格了
      ["until-renew", undefined],
      ["mail-server", undefined],
      // 含 "id" 不该误判为 ID — IDN 严格了
      ["bridge-route", undefined],
      ["video-edge", undefined],
      ["guide-fast", undefined],
      // 含 "es" 不该误判为 ES — \bES[P]?\d*\b 词边界保护
      ["test-server", undefined],
      ["yes-fast", undefined],
      ["business-edge", undefined],
      // 含 "be" 不该误判为 BE — BE 已用 alpha-3 only
      ["be-sure-route", undefined],
      ["to-be-fast", undefined],
      // 含 "at" 不该误判为 AT
      ["at-home-edge", undefined],
      ["at&t-line", undefined],
      // 含 "no" 不该误判为 NO
      ["no-proxy-here", undefined],
      ["no.1-fast", undefined],
      // 含 "is" 不该误判为 IS
      ["is-the-best", undefined],
      ["server-is-up", undefined],
      // 含 "ie" 不该误判为 IE
      ["i.e.-direct", undefined],
      // 含 "gb" (GigaByte) 不该误判为 GB
      ["剩余流量: 99 GB", undefined],
      ["100GB-traffic", undefined], // "GB" 前是数字,\bGB\b 边界生效? 100GB 中 GB 前是 0,是 \w,不构成 \b 边界
      // CNN 不该误判为 CN
      ["CNN-news-fast", undefined],
    ])("%s → %s", (name, expected) => {
      expect(annotateNode(n(name)).region).toBe(expected);
    });
  });

  describe("North Korea 不应被识别为 KR (顺序保证)", () => {
    it("North Korea → KP", () => {
      expect(annotateNode(n("North Korea Server")).region).toBe("KP");
    });

    it("朝鲜 → KP", () => {
      expect(annotateNode(n("朝鲜-Direct")).region).toBe("KP");
    });
  });

  describe("region 已被显式设置时不覆盖", () => {
    it("不动已有 region", () => {
      const node: Node = { ...n("🇯🇵 Tokyo"), region: "US" };
      expect(annotateNode(node).region).toBe("US");
    });
  });

  describe("无任何地区信息的节点 region = undefined", () => {
    it.each([
      "Server-01",
      "Premium-Direct",
      "Edge-Cloud",
      "节点-01",
      "0.5x-IEPL",
    ])("%s → undefined", (name) => {
      expect(annotateNode(n(name)).region).toBeUndefined();
    });
  });

  describe("新增地区覆盖", () => {
    it.each([
      ["澳门-MO-Premium", "MO"],
      ["Macao-CTM", "MO"],
      ["瑞典-Stockholm", "SE"],
      ["挪威-Oslo", "NO"],
      ["丹麦-Copenhagen", "DK"],
      ["芬兰-Helsinki", "FI"],
      ["冰岛-Reykjavik", "IS"],
      ["波兰-Warsaw", "PL"],
      ["乌克兰-Kyiv", "UA"],
      ["奥地利-Vienna", "AT"],
      ["比利时-Brussels", "BE"],
      ["葡萄牙-Lisbon", "PT"],
      ["爱尔兰-Dublin", "IE"],
      ["卢森堡-Direct", "LU"],
      ["埃及-Cairo", "EG"],
      ["南非-Johannesburg", "ZA"],
    ])("%s → %s", (name, code) => {
      expect(annotateNode(n(name)).region).toBe(code);
    });
  });
});
