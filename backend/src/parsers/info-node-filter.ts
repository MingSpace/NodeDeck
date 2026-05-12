import type { Node } from "../schemas/node.js";

// @business_rule: 机场惯例 —— 把套餐用量/到期/公告塞成假 trojan/ss 节点(server/port/password
// 跟某条真节点完全一样)放在订阅顶部。这些"信息节点"对客户端没意义:
//   - userinfo 已经从 HTTP Subscription-UserInfo header 拿(`schemas/userinfo.ts`),不依赖它们
//   - 它们和真节点的 identity (type|server|port|secret) 相同,会被 `dedupeNodes` 误合并,
//     反而把真节点挤掉(用户在客户端看到的是 `Traffic: ...` 这种不可用的伪节点)
//
// 因此在 parser 出口统一识别 + 丢弃。下游消费(策略组、profile、订阅生成、节点池 dashboard)
// 不需要任何改动,默认就拿到干净的节点。
//
// 识别算法:`<LEAD><KEYWORD><STRONG_SEP|WEAK_SEP>`
//   - LEAD = 0..N 个"装饰字符"(emoji/旗帜/空白/标点),不允许出现 ASCII 字母、数字、下划线、汉字。
//           保证关键字位于 name 的语义前缀,而非中段。
//   - KEYWORD = 信息节点关键字(流量/到期/重置/公告/官网/...),覆盖中英文常见形态。
//   - STRONG_SEP = 冒号 / 竖线 / 类似符号(`: ：| │ ┃ ∶`),前后空白可有可无。
//                  这是机场最常用的分隔形式,例如 `Traffic: 100 GB` `到期:2027-05-02`。
//   - WEAK_SEP = `- = ~ ·` 等,必须两侧都带空白,避免误伤 `Notice-Premium-01` / `expired-policy`。
//
// 不动手动节点:用户自己加的不可能是信息节点。

// 中文范围:基本 CJK + 扩展 A,覆盖 99% 真节点 name。
const NON_LEAD_CHARS = String.raw`A-Za-z0-9_\u4E00-\u9FFF\u3400-\u4DBF`;
const LEAD = `^[^${NON_LEAD_CHARS}]*`;

// 强分隔符:冒号(半/全角)、竖线类、ratio 符号。允许两侧空白。
const STRONG_SEP = String.raw`\s*[:\uFF1A|\u2502\u2503\u2236]+\s*`;
// 弱分隔符:`-` `=` `~` `·` 以及方块装饰字符,**必须两侧都有空白**。
const WEAK_SEP = String.raw`\s+[\-=~·\u2500\u2501\u258E\u258F\u258D\u258C\u258B\u258A\u2589]+\s+`;
const SEP = `(?:${STRONG_SEP}|${WEAK_SEP})`;

// 关键字按长度倒序,保证 alternation 优先匹配最长形态(e.g. `本月已用` 优先于 `本月`)。
const KEYWORDS: readonly string[] = [
  // 流量类
  "剩余流量",
  "本月已用",
  "本月用量",
  "本月流量",
  "已用流量",
  "套餐流量",
  "流量信息",
  "流量重置",
  "总流量",
  "流量",
  "Traffic",
  "Data Usage",
  "Used",
  // 到期类
  "ExpireDate",
  "ExpiresAt",
  "Valid Until",
  "Expires",
  "Expired",
  "Expire",
  "过期时间",
  "到期时间",
  "有效时间",
  "有效期",
  "过期",
  "到期",
  // 重置类
  "距离下次重置剩余",
  "距离下一次重置",
  "距离下次重置",
  "流量重置日",
  "下次重置",
  "Reset In",
  "Reset",
  // 公告 / 套餐
  "套餐到期",
  "套餐信息",
  "当前套餐",
  "订阅信息",
  "Announcement",
  "Subscription",
  "Plan Info",
  "Notice",
  "公告",
  "通知",
  // 官网 / TG / 联系方式
  "Telegram Group",
  "官方网站",
  "访问官网",
  "访问网站",
  "官方网址",
  "官方TG",
  "Website",
  "公众号",
  "官网",
  "网址",
];

function escapeAndSpace(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, String.raw`\s+`);
}

const KEYWORDS_SORTED = [...KEYWORDS].sort((a, b) => b.length - a.length);
const KEYWORD_GROUP = KEYWORDS_SORTED.map(escapeAndSpace).join("|");
const MAIN_REGEX = new RegExp(`${LEAD}(?:${KEYWORD_GROUP})${SEP}`, "i");

// name 整体就是一个 URL(没有任何节点语义),例如 `https://example.com/dashboard`
const URL_NAME_REGEX = /^\s*https?:\/\//i;
// 纯 Telegram 链接 / 凭空一个 @handle 作 name
const TELEGRAM_NAME_REGEX = /^\s*(?:t\.me\/|tg:\/\/|@\w+\s*$)/i;

export function isInfoNode(node: Pick<Node, "name">): boolean {
  const name = node.name ?? "";
  if (!name) return false;
  if (URL_NAME_REGEX.test(name)) return true;
  if (TELEGRAM_NAME_REGEX.test(name)) return true;
  return MAIN_REGEX.test(name);
}

export interface FilterInfoNodesResult {
  kept: Node[];
  dropped: Node[];
}

export function filterInfoNodes(nodes: Node[]): Node[] {
  const out: Node[] = [];
  for (const n of nodes) {
    if (!isInfoNode(n)) out.push(n);
  }
  return out;
}

export function filterInfoNodesWithReport(nodes: Node[]): FilterInfoNodesResult {
  const kept: Node[] = [];
  const dropped: Node[] = [];
  for (const n of nodes) {
    (isInfoNode(n) ? dropped : kept).push(n);
  }
  return { kept, dropped };
}
