import { Writable } from "node:stream";
import { env } from "./env.js";

/**
 * pino 默认每行写一个 JSON,字段为 level(数字)/time/msg/...。
 * 这里把它解析成 UI 能直接消费的扁平结构;原始 JSON 也保留下来,便于前端展开排查。
 */
export interface LogEntry {
  /** 单调递增 id (内部计数器),防止时间戳同毫秒重复造成 SSE Last-Event-ID 冲突。 */
  id: number;
  /** 毫秒时间戳。 */
  ts: number;
  /** pino 数字级别: 10/20/30/40/50/60。 */
  level: number;
  /** 文字级别: trace/debug/info/warn/error/fatal。 */
  levelLabel: string;
  /** 主消息字段。 */
  msg: string;
  /** 原始 JSON 行(已脱敏,保留所有附加上下文)。 */
  raw: string;
}

const LEVEL_LABEL: Record<number, string> = {
  10: "trace",
  20: "debug",
  30: "info",
  40: "warn",
  50: "error",
  60: "fatal",
};

type Subscriber = (entry: LogEntry) => void;

class LogBuffer {
  private readonly buf: (LogEntry | undefined)[];
  private readonly capacity: number;
  /** 下一个写入位置(环形)。 */
  private writeIdx = 0;
  /** 当前 buffer 中的有效条目数(未满时小于 capacity)。 */
  private size = 0;
  private nextId = 1;
  private readonly subs = new Set<Subscriber>();

  constructor(capacity: number) {
    this.capacity = Math.max(1, capacity);
    this.buf = new Array(this.capacity);
  }

  push(entry: Omit<LogEntry, "id">): LogEntry {
    // spread 在前、id 在后:即便 entry 中带占位 id 字段(parseLine 兜底)也会被覆盖。
    const full: LogEntry = { ...entry, id: this.nextId++ };
    this.buf[this.writeIdx] = full;
    this.writeIdx = (this.writeIdx + 1) % this.capacity;
    if (this.size < this.capacity) this.size++;
    for (const fn of this.subs) {
      try {
        fn(full);
      } catch {
        // 单个订阅者抛错不影响其他订阅者 / 主写入路径。
      }
    }
    return full;
  }

  /** 返回当前 buffer 内的所有条目,按写入顺序(旧 → 新)。 */
  snapshot(): LogEntry[] {
    if (this.size === 0) return [];
    const out: LogEntry[] = [];
    const start =
      this.size < this.capacity ? 0 : this.writeIdx; // 满时,最旧位置 = writeIdx
    for (let i = 0; i < this.size; i++) {
      const idx = (start + i) % this.capacity;
      const item = this.buf[idx];
      if (item) out.push(item);
    }
    return out;
  }

  subscribe(fn: Subscriber): () => void {
    this.subs.add(fn);
    return () => {
      this.subs.delete(fn);
    };
  }

  /**
   * 用磁盘上的历史日志回填 buffer:历史条目排在当前进程已产生的条目之前,
   * id 全部重新分配以保持"buffer 内顺序 = id 递增"这一 SSE Last-Event-ID 前提。
   *
   * 只在进程启动、还没有任何 SSE 订阅者时调用(此时 push 的广播是空操作),
   * 运行期调用会让已连接的客户端收到乱序 id。
   */
  restore(historical: Omit<LogEntry, "id">[]): void {
    if (historical.length === 0) return;
    const current = this.snapshot();
    this._reset();
    for (const entry of historical) this.push(entry);
    for (const entry of current) this.push(entry);
  }

  /** 仅供单元测试使用,生产代码不要调用。 */
  _reset(): void {
    this.writeIdx = 0;
    this.size = 0;
    this.nextId = 1;
    this.buf.fill(undefined);
  }

  get subscriberCount(): number {
    return this.subs.size;
  }
}

export const logBuffer = new LogBuffer(env.LOG_BUFFER_SIZE);

/**
 * 落盘钩子。由 log-store 在被 import 时注册(默认 null = 只留内存),
 * 这样 log-buffer 本身不依赖 fs / DATA_DIR,单元测试里也不会意外写文件。
 */
type LineSink = (line: string, ts: number) => void;

let lineSink: LineSink | null = null;

export function setLogLineSink(sink: LineSink | null): void {
  lineSink = sink;
}

export function parseLine(line: string): LogEntry | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    const level = typeof obj.level === "number" ? obj.level : 30;
    const ts = typeof obj.time === "number" ? obj.time : Date.now();
    const msg = typeof obj.msg === "string" ? obj.msg : "";
    return {
      id: 0, // 真正的 id 由 buffer.push 分配
      ts,
      level,
      levelLabel: LEVEL_LABEL[level] ?? String(level),
      msg,
      raw: trimmed,
    };
  } catch {
    // 非 JSON 行(理论上 pino 不会产生)直接当 info 文本兜底,避免静默丢日志。
    return {
      id: 0,
      ts: Date.now(),
      level: 30,
      levelLabel: "info",
      msg: trimmed,
      raw: trimmed,
    };
  }
}

class RingStream extends Writable {
  /** 可能跨 chunk 的尾部残行。 */
  private tail = "";

  override _write(
    chunk: Buffer | string,
    encoding: BufferEncoding | "buffer",
    callback: (error?: Error | null) => void,
  ): void {
    // pino multistream 直接调用 stream.write(data),Node Stream API 在 chunk 为 Buffer 时
    // 会把 encoding 设为 "buffer",这并非 BufferEncoding 字面量。统一按 utf8 解码即可。
    let text: string;
    if (typeof chunk === "string") {
      text = chunk;
    } else if (Buffer.isBuffer(chunk)) {
      text = chunk.toString("utf8");
    } else {
      text = String(chunk);
    }
    void encoding;
    const combined = this.tail + text;
    const lines = combined.split("\n");
    this.tail = lines.pop() ?? "";
    for (const line of lines) {
      const entry = parseLine(line);
      if (!entry) continue;
      logBuffer.push(entry);
      // 落盘写原始行(已脱敏),回填时用同一个 parseLine 解析,内存与磁盘形态完全一致。
      lineSink?.(entry.raw, entry.ts);
    }
    callback();
  }
}

/** pino multistream 的目标流: 解析每行 JSON 并 push 进 ring buffer。 */
export const ringStream = new RingStream();
