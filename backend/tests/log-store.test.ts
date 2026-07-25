import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DATA_DIR 指向临时目录,避免测试污染仓库里的 data/。
// vi.hoisted 里不能 import,所以路径用字符串拼(不需要 fs / os)。
const DATA_DIR = vi.hoisted(
  () => `${process.env.TMPDIR?.replace(/\/$/, "") ?? "/tmp"}/nodedeck-log-store-${process.pid}`,
);

vi.mock("../src/env.js", () => ({
  env: {
    NODE_ENV: "test",
    PORT: 8080,
    DATA_DIR,
    INITIAL_PASSWORD: "changeme",
    SESSION_SECRET: "test-secret-test-secret",
    LOG_LEVEL: "info",
    LOG_BUFFER_SIZE: 10,
  },
}));

import { logBuffer, ringStream } from "../src/log-buffer.js";
import {
  _resetLogStore,
  appendLogLine,
  flushLogStore,
  pruneOldLogFiles,
  restoreRecentLogs,
  setLogRetentionDays,
} from "../src/log-store.js";

const LOGS_DIR = join(DATA_DIR, "logs");

function line(msg: string, ts: number, level = 30): string {
  return JSON.stringify({ level, time: ts, msg });
}

/** 本地日期的 YYYY-MM-DD,与 log-store 的文件名规则一致。 */
function dayKey(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function daysAgo(n: number): number {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return d.getTime();
}

function seedFile(ts: number, lines: string[]): string {
  mkdirSync(LOGS_DIR, { recursive: true });
  const name = `${dayKey(ts)}.log`;
  writeFileSync(join(LOGS_DIR, name), lines.map((l) => `${l}\n`).join(""), "utf8");
  return name;
}

beforeEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
});

afterEach(async () => {
  await flushLogStore();
  _resetLogStore();
  logBuffer._reset();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("appendLogLine", () => {
  it("按本地日期把原始 JSON 行追加到 data/logs/<day>.log", async () => {
    const now = Date.now();
    appendLogLine(line("hello", now), now);
    appendLogLine(line("world", now), now);
    await flushLogStore();

    const content = readFileSync(join(LOGS_DIR, `${dayKey(now)}.log`), "utf8");
    expect(content.trimEnd().split("\n")).toHaveLength(2);
    expect(content).toContain("hello");
    expect(content).toContain("world");
  });

  it("retention_days = 0 时不落盘", async () => {
    setLogRetentionDays(0);
    const now = Date.now();
    appendLogLine(line("nope", now), now);
    await flushLogStore();
    expect(existsSync(join(LOGS_DIR, `${dayKey(now)}.log`))).toBe(false);
  });

  it("ringStream 收到 pino 行时同时进内存与磁盘", async () => {
    const now = Date.now();
    ringStream.write(`${line("through-sink", now, 40)}\n`);
    await flushLogStore();

    expect(logBuffer.snapshot().map((e) => e.msg)).toEqual(["through-sink"]);
    expect(readFileSync(join(LOGS_DIR, `${dayKey(now)}.log`), "utf8")).toContain("through-sink");
  });
});

describe("pruneOldLogFiles", () => {
  it("默认 3 天:保留今天 + 前两天,更早的删掉", () => {
    seedFile(daysAgo(0), [line("today", daysAgo(0))]);
    seedFile(daysAgo(2), [line("d2", daysAgo(2))]);
    seedFile(daysAgo(3), [line("d3", daysAgo(3))]);
    seedFile(daysAgo(9), [line("d9", daysAgo(9))]);

    const removed = pruneOldLogFiles();

    expect(removed.sort()).toEqual([`${dayKey(daysAgo(3))}.log`, `${dayKey(daysAgo(9))}.log`].sort());
    expect(readdirSync(LOGS_DIR).sort()).toEqual(
      [`${dayKey(daysAgo(0))}.log`, `${dayKey(daysAgo(2))}.log`].sort(),
    );
  });

  it("不认识的文件名不动", () => {
    mkdirSync(LOGS_DIR, { recursive: true });
    writeFileSync(join(LOGS_DIR, "notes.txt"), "keep me", "utf8");
    seedFile(daysAgo(9), [line("old", daysAgo(9))]);

    pruneOldLogFiles();

    expect(readdirSync(LOGS_DIR)).toEqual(["notes.txt"]);
  });

  it("retention 调到 0 时清空整个目录", () => {
    seedFile(daysAgo(0), [line("today", daysAgo(0))]);
    setLogRetentionDays(0);
    expect(readdirSync(LOGS_DIR)).toEqual([]);
  });

  it("retention 缩小后立即生效", () => {
    seedFile(daysAgo(0), [line("today", daysAgo(0))]);
    seedFile(daysAgo(2), [line("d2", daysAgo(2))]);
    setLogRetentionDays(1);
    expect(readdirSync(LOGS_DIR)).toEqual([`${dayKey(daysAgo(0))}.log`]);
  });
});

describe("restoreRecentLogs", () => {
  it("跨文件按时间顺序回填(旧 → 新)", () => {
    seedFile(daysAgo(1), [line("yesterday-1", daysAgo(1)), line("yesterday-2", daysAgo(1))]);
    seedFile(daysAgo(0), [line("today-1", daysAgo(0))]);

    const restored = restoreRecentLogs();

    expect(restored).toBe(3);
    expect(logBuffer.snapshot().map((e) => e.msg)).toEqual([
      "yesterday-1",
      "yesterday-2",
      "today-1",
    ]);
  });

  it("超过 limit 时只保留最新的若干条", () => {
    seedFile(daysAgo(1), [line("old", daysAgo(1))]);
    seedFile(daysAgo(0), [line("a", daysAgo(0)), line("b", daysAgo(0))]);

    expect(restoreRecentLogs(2)).toBe(2);
    expect(logBuffer.snapshot().map((e) => e.msg)).toEqual(["a", "b"]);
  });

  it("历史条目排在当前进程已有条目之前,id 保持递增", () => {
    seedFile(daysAgo(1), [line("from-disk", daysAgo(1))]);
    logBuffer.push({ ts: Date.now(), level: 30, levelLabel: "info", msg: "live", raw: "{}" });

    restoreRecentLogs();

    const snap = logBuffer.snapshot();
    expect(snap.map((e) => e.msg)).toEqual(["from-disk", "live"]);
    expect(snap[1]!.id).toBeGreaterThan(snap[0]!.id);
  });

  it("不会把本进程刚写进文件的行重复回填", async () => {
    const now = Date.now();
    seedFile(now, [line("before-restart", now)]);
    ringStream.write(`${line("after-start", now)}\n`);
    await flushLogStore();

    restoreRecentLogs();

    expect(logBuffer.snapshot().map((e) => e.msg)).toEqual(["before-restart", "after-start"]);
  });

  it("目录不存在时安全返回 0", () => {
    expect(restoreRecentLogs()).toBe(0);
  });

  it("忽略空行与残缺行,不污染 buffer", () => {
    mkdirSync(LOGS_DIR, { recursive: true });
    writeFileSync(
      join(LOGS_DIR, `${dayKey(daysAgo(0))}.log`),
      `${line("ok", daysAgo(0))}\n\n   \n`,
      "utf8",
    );

    expect(restoreRecentLogs()).toBe(1);
    expect(logBuffer.snapshot().map((e) => e.msg)).toEqual(["ok"]);
  });
});
