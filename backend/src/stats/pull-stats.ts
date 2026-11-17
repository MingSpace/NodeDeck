import { z } from "zod";
import { readJson, writeJson } from "../storage/yaml-io.js";
import { dataPath } from "../storage/paths.js";
import { logger } from "../logger.js";
import { classifyIp, describeUserAgent, type IpScope, type UserAgentDetail } from "./user-agent.js";

/**
 * 订阅拉取统计:按天汇总每个 Profile 被 Clash / Surge 拉了几次,外加最近拉过的客户端(IP + 客户端类型)。
 * 只存汇总数字,不存逐条请求;文件 data/stats/pulls.json,程序自读自写,不进 chokidar。
 *
 * 和其它实体不同,这里在内存里攒计数、每分钟落一次盘:每次拉取都写文件不值得,
 * 进程被 SIGKILL 时最多丢最后一分钟的计数,统计数据可以接受。正常退出由 flushPullStats 落盘。
 */

export const STATS_RETENTION_DAYS = 90;
const DEVICE_RETENTION_DAYS = 30;
/** 仪表盘「设备」只看最近 7 天:手机切换 Wi-Fi / 蜂窝会换 IP,窗口拉长同一台设备会被算成好几台 */
const DEVICE_WINDOW_DAYS = 7;
const MAX_DEVICES = 200;
const FLUSH_INTERVAL_MS = 60_000;
const DAY_MS = 86_400_000;

const countSchema = z.object({
  clash: z.number().int().nonnegative().default(0),
  surge: z.number().int().nonnegative().default(0),
});
const daySchema = z.object({
  profiles: z.record(countSchema).default({}),
  /** 当天 token 不对被拒绝的次数 */
  rejected: z.number().int().nonnegative().default(0),
});
const deviceSchema = z.object({
  ip: z.string(),
  client: z.string(),
  user_agent: z.string(),
  profile_id: z.string(),
  target: z.enum(["clash", "surge"]),
  first_seen: z.number(),
  last_seen: z.number(),
  count: z.number().int().nonnegative(),
});
const statsSchema = z.object({
  version: z.literal(1),
  days: z.record(daySchema).default({}),
  /** profile id → 最后一次被拉取的时间 */
  last_pulls: z.record(z.number()).default({}),
  /** `${ip}|${client}` → 设备 */
  devices: z.record(deviceSchema).default({}),
});

export type PullStats = z.infer<typeof statsSchema>;
type Device = z.infer<typeof deviceSchema>;

// 顺序有讲究:具体的客户端排前面,泛泛的 clash / mihomo 兜底
const CLIENT_PATTERNS: Array<[RegExp, string]> = [
  [/surge.*(ios|iphone|ipad)/i, "Surge iOS"],
  [/surge.*(mac|darwin)/i, "Surge Mac"],
  [/surge/i, "Surge"],
  [/stash/i, "Stash"],
  [/shadowrocket/i, "Shadowrocket"],
  [/loon/i, "Loon"],
  [/quantumult/i, "Quantumult X"],
  [/clash[ -]?verge/i, "Clash Verge"],
  [/flclash/i, "FlClash"],
  [/clash[ -]?nyanpasu/i, "Clash Nyanpasu"],
  [/clashmetaforandroid|clash[ .-]?meta.*android/i, "Clash Meta Android"],
  [/mihomo|clash[ .-]?meta/i, "mihomo"],
  [/clash/i, "Clash"],
];

/** 从 User-Agent 认出客户端;认不出就取 UA 第一段 */
export function classifyClient(userAgent: string | undefined): string {
  const ua = userAgent?.trim();
  if (!ua) return "未知客户端";
  for (const [pattern, label] of CLIENT_PATTERNS) {
    if (pattern.test(ua)) return label;
  }
  return ua.split(/[/\s]/)[0].slice(0, 24) || "未知客户端";
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function dayKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 以本地零点为基准偏移天数,避开 DST 下「减 86400000 毫秒」跨错日期 */
function shiftDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function emptyStats(): PullStats {
  return { version: 1, days: {}, last_pulls: {}, devices: {} };
}

let state: PullStats | null = null;
let dirty = false;
let timer: NodeJS.Timeout | null = null;
let writing: Promise<void> = Promise.resolve();

function current(): PullStats {
  state ??= emptyStats();
  return state;
}

export function pullStatsPath(): string {
  return dataPath("stats", "pulls.json");
}

/** 启动时读盘并开始定时落盘;文件坏了就从空的开始(下次落盘覆盖) */
export async function initPullStats(): Promise<void> {
  const raw = await readJson<unknown>(pullStatsPath());
  if (raw !== null) {
    const parsed = statsSchema.safeParse(raw);
    if (parsed.success) {
      // 启动早期已记下的几次拉取不丢:只在内存还是空的时候用磁盘上的
      if (!state) state = parsed.data;
    } else {
      logger.warn({ path: pullStatsPath() }, "Pull stats file invalid, starting fresh");
    }
  }
  if (!timer) {
    timer = setInterval(() => void flushPullStats(), FLUSH_INTERVAL_MS);
    timer.unref();
  }
}

export function recordPull(args: {
  profileId: string;
  target: "clash" | "surge";
  ip: string;
  userAgent?: string;
  now?: number;
}): void {
  const now = args.now ?? Date.now();
  const s = current();
  const day = (s.days[dayKey(now)] ??= { profiles: {}, rejected: 0 });
  const count = (day.profiles[args.profileId] ??= { clash: 0, surge: 0 });
  count[args.target]++;
  s.last_pulls[args.profileId] = now;

  const client = classifyClient(args.userAgent);
  const key = `${args.ip}|${client}`;
  const prev = s.devices[key];
  s.devices[key] = {
    ip: args.ip,
    client,
    user_agent: (args.userAgent ?? "").slice(0, 240),
    profile_id: args.profileId,
    target: args.target,
    first_seen: prev?.first_seen ?? now,
    last_seen: now,
    count: (prev?.count ?? 0) + 1,
  };
  dirty = true;
}

export function recordRejected(now = Date.now()): void {
  const day = (current().days[dayKey(now)] ??= { profiles: {}, rejected: 0 });
  day.rejected++;
  dirty = true;
}

export function prunePullStats(s: PullStats, now = Date.now()): void {
  const cutoff = dayKey(shiftDays(now, -(STATS_RETENTION_DAYS - 1)));
  for (const day of Object.keys(s.days)) {
    if (day < cutoff) delete s.days[day];
  }
  const deviceCutoff = now - DEVICE_RETENTION_DAYS * DAY_MS;
  const devices = Object.entries(s.devices)
    .filter(([, d]) => d.last_seen >= deviceCutoff)
    .sort(([, a], [, b]) => b.last_seen - a.last_seen)
    .slice(0, MAX_DEVICES);
  s.devices = Object.fromEntries(devices);
}

/** 有新计数才写;串行化,避免定时器和退出钩子同时写同一个文件 */
export function flushPullStats(): Promise<void> {
  writing = writing.then(async () => {
    if (!dirty || !state) return;
    dirty = false;
    prunePullStats(state);
    try {
      await writeJson(pullStatsPath(), state);
    } catch (err) {
      dirty = true;
      logger.warn({ err }, "Failed to write pull stats");
    }
  });
  return writing;
}

export interface PullSummary {
  /** 最近 N 天,最早的在前,没有拉取的日子补 0 */
  days: { date: string; clash: number; surge: number }[];
  today: number;
  /** 有记录的最早一天;仪表盘据此提示「从哪天开始统计」 */
  since?: string;
  /** 窗口内 token 不对被拒绝的次数 */
  rejected: number;
  profiles: Record<string, { last7: number; last_pull_at?: number }>;
  /** 最近 7 天拉过的设备,最近的在前 */
  devices: (Device & UserAgentDetail & { ip_scope: IpScope })[];
}

export function summarizePulls(windowDays = 30, now = Date.now(), s: PullStats = current()): PullSummary {
  const days: PullSummary["days"] = [];
  let rejected = 0;
  for (let i = windowDays - 1; i >= 0; i--) {
    const date = dayKey(shiftDays(now, -i));
    const day = s.days[date];
    let clash = 0;
    let surge = 0;
    for (const c of Object.values(day?.profiles ?? {})) {
      clash += c.clash;
      surge += c.surge;
    }
    rejected += day?.rejected ?? 0;
    days.push({ date, clash, surge });
  }
  const last = days[days.length - 1];

  const profiles: PullSummary["profiles"] = {};
  const weekStart = dayKey(shiftDays(now, -6));
  for (const [date, day] of Object.entries(s.days)) {
    if (date < weekStart) continue;
    for (const [id, c] of Object.entries(day.profiles)) {
      (profiles[id] ??= { last7: 0 }).last7 += c.clash + c.surge;
    }
  }
  for (const [id, ts] of Object.entries(s.last_pulls)) {
    (profiles[id] ??= { last7: 0 }).last_pull_at = ts;
  }

  const deviceCutoff = now - DEVICE_WINDOW_DAYS * DAY_MS;
  const devices = Object.values(s.devices)
    .filter((d) => d.last_seen >= deviceCutoff)
    .sort((a, b) => b.last_seen - a.last_seen)
    .map((d) => ({ ...d, ...describeUserAgent(d.user_agent), ip_scope: classifyIp(d.ip) }));

  const recorded = Object.keys(s.days).sort();
  return {
    days,
    today: last.clash + last.surge,
    since: recorded[0],
    rejected,
    profiles,
    devices,
  };
}

/** 仅测试用 */
export function _resetPullStats(next: PullStats | null = null): void {
  state = next;
  dirty = false;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
