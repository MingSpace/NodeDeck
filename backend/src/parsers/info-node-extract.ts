// 从机场塞的「信息节点」名字里提取到期日 / 流量 / 重置倒计时。
// 这些节点在 parser 出口会被丢弃(见 info-node-filter.ts),丢之前把名字交给这里,
// 结果随刷新写进 provider cache(info_quota),供 providers/quota.ts 判定配额。
//
// 只认能确定含义的形态,认不出就不给,宁缺毋滥:
//   到期   `Expire: 2027-04-02` / `Expire Date：2027/06/18` / `套餐到期：2027年4月2日`
//   流量   `Traffic: 73.93 GB | 150 GB`(已用 | 总量)/ `剩余流量：76 GB | 150 GB`(剩余 | 总量)/ 纯 `45.35 GB | 200 GB`
//   重置   `Traffic Reset：4 Days Left` / `距离下次重置剩余：25 天` / `下次重置：2026-11-02`

export interface InfoNodeQuota {
  /** 到期日 "YYYY-MM-DD"(按进程本地时区零点解释) */
  expire?: string;
  /** 流量(字节),total > 0 */
  traffic?: { used: number; total: number };
  /** 下次重置日零点(ms),由倒计时天数或日期推算 */
  reset_at?: number;
}

const DATE = String.raw`(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})`;
const EXPIRE_RE = new RegExp(
  String.raw`(?:expire|valid\s*until|到期|过期|有效期)[^\d]{0,16}${DATE}`,
  "i",
);
const RESET_KEYWORD_RE = /reset|重置/i;
const RESET_DAYS_RE = /(\d{1,3})\s*(?:天|days?)/i;
const RESET_DATE_RE = new RegExp(DATE);

const UNIT_POW: Record<string, number> = { B: 0, K: 1, M: 2, G: 3, T: 4, P: 5 };
// 单位必须有(`2027/06/18` 这种日期不能被当成流量),`G` / `GB` / `GiB` 都认
const AMOUNT = String.raw`(\d+(?:\.\d+)?)\s*([KMGTP])(?:i?B)?(?![A-Za-z])`;
const TRAFFIC_PAIR_RE = new RegExp(
  String.raw`${AMOUNT}\s*[|/／│┃／]\s*${AMOUNT}`,
  "i",
);
const REMAINING_RE = /剩余|remain|left/i;

function toBytes(value: string, unit: string): number {
  const pow = UNIT_POW[unit.toUpperCase()] ?? 3;
  return Math.round(Number.parseFloat(value) * 1024 ** pow);
}

function toDateString(y: string, m: string, d: string): string | undefined {
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const dt = new Date(year, month - 1, day);
  if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return undefined;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function parseExpire(name: string): string | undefined {
  const m = EXPIRE_RE.exec(name);
  return m ? toDateString(m[1], m[2], m[3]) : undefined;
}

function parseReset(name: string, fetchedAt: number): number | undefined {
  if (!RESET_KEYWORD_RE.test(name)) return undefined;
  const date = RESET_DATE_RE.exec(name);
  if (date) {
    const s = toDateString(date[1], date[2], date[3]);
    if (s) {
      const [y, m, d] = s.split("-").map(Number);
      return new Date(y, m - 1, d).getTime();
    }
  }
  const days = RESET_DAYS_RE.exec(name);
  if (days) return startOfLocalDay(fetchedAt) + Number(days[1]) * 86_400_000;
  return undefined;
}

function parseTraffic(name: string): InfoNodeQuota["traffic"] {
  const m = TRAFFIC_PAIR_RE.exec(name);
  if (!m) return undefined;
  const first = toBytes(m[1], m[2]);
  const total = toBytes(m[3], m[4]);
  if (total <= 0) return undefined;
  // `剩余 | 总量` 换算成已用;其余一律按 `已用 | 总量`
  const used = REMAINING_RE.test(name) ? Math.max(0, total - first) : first;
  return { used, total };
}

/**
 * @param names 被 info-node-filter 判为信息节点的节点名
 * @param fetchedAt 拿到这份内容的时间,用于把「还剩 N 天重置」换算成日期
 */
export function extractInfoNodeQuota(names: string[], fetchedAt: number): InfoNodeQuota | undefined {
  const out: InfoNodeQuota = {};
  for (const name of names) {
    // 重置行常带 Traffic 字样(`Traffic Reset：4 Days Left`),先认重置,认到了就不再当流量 / 到期解析
    const resetAt = parseReset(name, fetchedAt);
    if (resetAt !== undefined) {
      out.reset_at ??= resetAt;
      continue;
    }
    const expire = parseExpire(name);
    if (expire) {
      out.expire ??= expire;
      continue;
    }
    out.traffic ??= parseTraffic(name);
  }
  return out.expire || out.traffic || out.reset_at !== undefined ? out : undefined;
}
