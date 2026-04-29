import type { Node } from "../schemas/node.js";

const REGION_FLAGS: Array<{ regex: RegExp; code: string; keywords: string[] }> = [
  { regex: /🇭🇰/, code: "HK", keywords: ["hk", "hong kong", "hongkong", "香港"] },
  { regex: /🇹🇼/, code: "TW", keywords: ["tw", "taiwan", "台湾", "台灣"] },
  { regex: /🇯🇵/, code: "JP", keywords: ["jp", "japan", "日本", "东京", "tokyo", "osaka"] },
  { regex: /🇸🇬/, code: "SG", keywords: ["sg", "singapore", "新加坡", "狮城"] },
  { regex: /🇺🇸/, code: "US", keywords: ["us", "usa", "united states", "美国", "america"] },
  { regex: /🇨🇳/, code: "CN", keywords: ["cn", "china", "中国"] },
  { regex: /🇰🇷/, code: "KR", keywords: ["kr", "korea", "韩国", "首尔"] },
  { regex: /🇩🇪/, code: "DE", keywords: ["de", "germany", "德国"] },
  { regex: /🇬🇧/, code: "GB", keywords: ["gb", "uk", "britain", "england", "英国", "united kingdom"] },
  { regex: /🇫🇷/, code: "FR", keywords: ["fr", "france", "法国"] },
  { regex: /🇨🇦/, code: "CA", keywords: ["ca", "canada", "加拿大"] },
  { regex: /🇦🇺/, code: "AU", keywords: ["au", "australia", "澳大利亚", "悉尼"] },
  { regex: /🇳🇿/, code: "NZ", keywords: ["nz", "new zealand", "新西兰"] },
  { regex: /🇳🇱/, code: "NL", keywords: ["nl", "netherlands", "荷兰"] },
  { regex: /🇮🇳/, code: "IN", keywords: ["in", "india", "印度"] },
  { regex: /🇮🇩/, code: "ID", keywords: ["id", "indonesia", "印尼"] },
  { regex: /🇹🇭/, code: "TH", keywords: ["th", "thailand", "泰国"] },
  { regex: /🇻🇳/, code: "VN", keywords: ["vn", "vietnam", "越南"] },
  { regex: /🇲🇾/, code: "MY", keywords: ["my", "malaysia", "马来西亚"] },
  { regex: /🇵🇭/, code: "PH", keywords: ["ph", "philippines", "菲律宾"] },
  { regex: /🇨🇭/, code: "CH", keywords: ["ch", "switzerland", "瑞士"] },
  { regex: /🇮🇹/, code: "IT", keywords: ["it", "italy", "意大利"] },
  { regex: /🇪🇸/, code: "ES", keywords: ["es", "spain", "西班牙"] },
  { regex: /🇹🇷/, code: "TR", keywords: ["tr", "turkey", "土耳其"] },
  { regex: /🇷🇺/, code: "RU", keywords: ["ru", "russia", "俄罗斯"] },
  { regex: /🇧🇷/, code: "BR", keywords: ["br", "brazil", "巴西"] },
  { regex: /🇦🇷/, code: "AR", keywords: ["ar", "argentina", "阿根廷"] },
  { regex: /🇲🇽/, code: "MX", keywords: ["mx", "mexico", "墨西哥"] },
  { regex: /🇦🇪/, code: "AE", keywords: ["ae", "uae", "阿联酋"] },
  { regex: /🇮🇱/, code: "IL", keywords: ["il", "israel", "以色列"] },
];

const LEVEL_KEYWORDS: Array<{ regex: RegExp; level: string }> = [
  { regex: /(?:实验性|experiment(?:al)?)/i, level: "experimental" },
  { regex: /(?:premium|高级|尊享|精品)/i, level: "premium" },
  { regex: /(?:标准|standard)/i, level: "standard" },
];

const LINE_KEYWORDS: Array<{ regex: RegExp; line: string }> = [
  { regex: /\bIEPL\b/i, line: "IEPL" },
  { regex: /\bIPLC\b/i, line: "IPLC" },
  { regex: /\bBGP\b/i, line: "BGP" },
  { regex: /\bGIA\b/i, line: "GIA" },
  { regex: /\bCN2\b/i, line: "CN2" },
];

export function annotateNode(node: Node): Node {
  const name = node.name.toLowerCase();
  if (!node.region) {
    for (const r of REGION_FLAGS) {
      if (r.regex.test(node.name) || r.keywords.some((k) => name.includes(k))) {
        node.region = r.code;
        break;
      }
    }
  }
  if (!node.level) {
    for (const l of LEVEL_KEYWORDS) {
      if (l.regex.test(node.name)) {
        node.level = l.level;
        break;
      }
    }
  }
  if (!node.line) {
    for (const l of LINE_KEYWORDS) {
      if (l.regex.test(node.name)) {
        node.line = l.line;
        break;
      }
    }
  }
  return node;
}

export function annotateNodes(nodes: Node[]): Node[] {
  return nodes.map(annotateNode);
}
