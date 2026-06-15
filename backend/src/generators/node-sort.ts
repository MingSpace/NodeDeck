import type { Node } from "../schemas/node.js";

// 固定地区优先级:常用地区靠前,其余已识别地区按 region 代码字母序,
// region 未识别(annotateNode 没匹配上且 yaml 未手填)的节点垫底。
const REGION_PRIORITY = ["HK", "TW", "JP", "SG", "US"];

const PRIORITY_INDEX = new Map(REGION_PRIORITY.map((code, i) => [code, i]));

function regionRank(region: string | undefined): { tier: number; key: string } {
  if (!region) return { tier: 2, key: "" };
  const idx = PRIORITY_INDEX.get(region);
  if (idx !== undefined) return { tier: 0, key: String(idx) };
  return { tier: 1, key: region };
}

// 按地区聚类的稳定排序:同地区内保持输入顺序(Provider 拼接后的原始顺序)。
export function sortNodesByRegion(nodes: Node[]): Node[] {
  return nodes.slice().sort((a, b) => {
    const ra = regionRank(a.region);
    const rb = regionRank(b.region);
    if (ra.tier !== rb.tier) return ra.tier - rb.tier;
    if (ra.tier === 0) return Number(ra.key) - Number(rb.key);
    return ra.key < rb.key ? -1 : ra.key > rb.key ? 1 : 0;
  });
}
