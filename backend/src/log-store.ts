import {
  closeSync,
  createWriteStream,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  unlinkSync,
  type WriteStream,
} from "node:fs";
import { env } from "./env.js";
import { logBuffer, parseLine, setLogLineSink, type LogEntry } from "./log-buffer.js";
import { logFilePath, logsDir } from "./storage/paths.js";

/**
 * 日志落盘:按本地日期切分的 NDJSON(`data/logs/YYYY-MM-DD.log`),每行就是 pino 的原始
 * JSON 行(已脱敏)。目的只有两个 —— 重启后 Web UI 还能看到之前的日志、以及回溯最近几天。
 *
 * 设计约束:
 * - 不引入任何日志库/数据库,文件仍是唯一真相,与 data/ 下其它配置一致。
 * - 保留天数由 `config.yaml` 的 `logs.retention_days` 控制,改完热生效(设置页保存会直接
 *   调用 setLogRetentionDays;手改 yaml 由维护定时器下一轮重新读取)。
 * - 这里绝对不能用 pino logger 打日志:那会重新进入 appendLogLine,写失败时无限递归。
 *   因此内部错误一律走 console.error,且同类错误只报一次。
 */

/** 与 schemas/config.ts 中 logs.retention_days 的默认值保持一致。 */
export const DEFAULT_LOG_RETENTION_DAYS = 3;

const MAINTENANCE_INTERVAL_MS = 60 * 60 * 1000;

/** 回填时单个文件最多读取的尾部字节数,防止异常暴涨的日志文件把内存吃光。 */
const MAX_TAIL_BYTES = 8 * 1024 * 1024;

const FILE_PATTERN = /^(\d{4}-\d{2}-\d{2})\.log$/;

let retentionDays = DEFAULT_LOG_RETENTION_DAYS;
let stream: WriteStream | null = null;
let streamDay = "";
/** 本进程已写入各日期文件的行数,回填时据此跳过"自己刚写的那几行",避免重复。 */
const appendedByDay = new Map<string, number>();
let maintenanceTimer: NodeJS.Timeout | null = null;
let writeErrorReported = false;

function dayKey(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 以本地零点为基准偏移天数,避开 DST 下"减 86400000 毫秒"跨错日期的坑。 */
function shiftDays(ts: number, days: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

function reportOnce(message: string, err: unknown): void {
  if (writeErrorReported) return;
  writeErrorReported = true;
  console.error(`[log-store] ${message}`, err);
}

function closeStream(): void {
  stream?.end();
  stream = null;
  streamDay = "";
}

/**
 * 等待缓冲区写完并释放当前文件句柄。进程退出前调用可以避免丢掉最后几行日志
 * (WriteStream 的写是异步的,默认 SIGTERM 会直接带着缓冲区一起死掉)。
 * 之后再有日志会自动重开文件,所以重复调用是安全的。
 */
export function flushLogStore(): Promise<void> {
  const current = stream;
  if (!current) return Promise.resolve();
  stream = null;
  streamDay = "";
  return new Promise((resolve) => current.end(() => resolve()));
}

function ensureStream(day: string): WriteStream {
  if (stream && streamDay === day) return stream;
  closeStream();
  mkdirSync(logsDir(), { recursive: true });
  const next = createWriteStream(logFilePath(day), { flags: "a" });
  // 磁盘满 / 权限问题是异步 error 事件,不监听会升级成 unhandled error 直接杀进程。
  next.on("error", (err) => reportOnce("write stream error", err));
  stream = next;
  streamDay = day;
  // 跨天换文件时顺手清理一次,长期不重启的进程不必只依赖定时器。
  pruneOldLogFiles();
  return next;
}

/** log-buffer 的落盘钩子:把一行原始 pino JSON 追加到当天的日志文件。 */
export function appendLogLine(line: string, ts: number): void {
  if (retentionDays <= 0) return;
  const day = dayKey(ts);
  try {
    ensureStream(day).write(`${line}\n`);
    appendedByDay.set(day, (appendedByDay.get(day) ?? 0) + 1);
  } catch (err) {
    reportOnce("failed to append log line", err);
  }
}

setLogLineSink(appendLogLine);

/**
 * 删除超出保留窗口的日志文件。
 * `retention_days: 3` = 保留今天 + 前两天共 3 个日期文件;`0` = 关闭落盘并清空目录。
 */
export function pruneOldLogFiles(now = Date.now()): string[] {
  const dir = logsDir();
  if (!existsSync(dir)) return [];
  // 文件名是 YYYY-MM-DD,可以直接按字典序比较。
  const cutoff = retentionDays > 0 ? dayKey(shiftDays(now, -(retentionDays - 1))) : null;
  const removed: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch (err) {
    reportOnce("failed to read log dir", err);
    return [];
  }
  for (const name of names) {
    const matched = FILE_PATTERN.exec(name);
    if (!matched) continue;
    if (cutoff !== null && matched[1] >= cutoff) continue;
    try {
      unlinkSync(logFilePath(matched[1]));
      removed.push(name);
    } catch (err) {
      reportOnce(`failed to delete ${name}`, err);
    }
  }
  return removed;
}

export function setLogRetentionDays(days: number): void {
  const next = Number.isFinite(days) ? Math.max(0, Math.trunc(days)) : DEFAULT_LOG_RETENTION_DAYS;
  if (next === retentionDays) {
    pruneOldLogFiles();
    return;
  }
  retentionDays = next;
  // 关闭落盘时先松开文件句柄,再让 prune 把目录清空。
  if (next === 0) closeStream();
  pruneOldLogFiles();
}

export function getLogRetentionDays(): number {
  return retentionDays;
}

/**
 * 用磁盘上的历史日志回填内存 buffer,新 → 旧地取到 limit 条为止。
 * 返回实际回填的条目数。
 */
export function restoreRecentLogs(limit = env.LOG_BUFFER_SIZE): number {
  const dir = logsDir();
  if (limit <= 0 || !existsSync(dir)) return 0;
  let days: string[];
  try {
    days = readdirSync(dir)
      .map((name) => FILE_PATTERN.exec(name)?.[1])
      .filter((day): day is string => Boolean(day))
      .sort()
      .reverse();
  } catch (err) {
    reportOnce("failed to list log files", err);
    return 0;
  }

  const newestFirst: string[] = [];
  for (const day of days) {
    if (newestFirst.length >= limit) break;
    const lines = readTailLines(logFilePath(day));
    // 本进程启动后自己写进去的行已经在 buffer 里了,从文件尾部剔除,否则回填会出现重复。
    const skip = appendedByDay.get(day) ?? 0;
    const usable = skip > 0 ? lines.slice(0, Math.max(0, lines.length - skip)) : lines;
    for (let i = usable.length - 1; i >= 0 && newestFirst.length < limit; i--) {
      newestFirst.push(usable[i]);
    }
  }

  const entries = newestFirst
    .reverse()
    .map((line) => parseLine(line))
    .filter((entry): entry is LogEntry => entry !== null);
  logBuffer.restore(entries);
  return entries.length;
}

function readTailLines(path: string): string[] {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const size = fstatSync(fd).size;
    const length = Math.min(size, MAX_TAIL_BYTES);
    const start = size - length;
    const buf = Buffer.allocUnsafe(length);
    let read = 0;
    while (read < length) {
      const n = readSync(fd, buf, read, length - read, start + read);
      if (n === 0) break;
      read += n;
    }
    const lines = buf.subarray(0, read).toString("utf8").split("\n");
    // 从中间截断时首行可能是半条记录(甚至半个 UTF-8 字符),直接丢掉。
    if (start > 0) lines.shift();
    return lines.filter((line) => line.trim().length > 0);
  } catch (err) {
    reportOnce(`failed to read ${path}`, err);
    return [];
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

export interface LogPersistenceInit {
  retentionDays: number;
  /**
   * 维护定时器每轮重新取一次保留天数,让直接手改 `data/config.yaml` 也能在一小时内生效
   * (设置页保存走 PUT /api/config,那条路径是立即生效的)。
   */
  refreshRetentionDays?: () => Promise<number>;
}

export function initLogPersistence(init: LogPersistenceInit): { restored: number } {
  setLogRetentionDays(init.retentionDays);
  const restored = restoreRecentLogs();
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = setInterval(() => {
    void runMaintenance(init.refreshRetentionDays);
  }, MAINTENANCE_INTERVAL_MS);
  maintenanceTimer.unref();
  return { restored };
}

async function runMaintenance(refresh?: () => Promise<number>): Promise<void> {
  if (refresh) {
    try {
      setLogRetentionDays(await refresh());
      return;
    } catch (err) {
      reportOnce("failed to refresh retention config", err);
    }
  }
  pruneOldLogFiles();
}

/** 仅供单元测试使用。 */
export function _resetLogStore(): void {
  if (maintenanceTimer) clearInterval(maintenanceTimer);
  maintenanceTimer = null;
  closeStream();
  appendedByDay.clear();
  retentionDays = DEFAULT_LOG_RETENTION_DAYS;
  writeErrorReported = false;
}
