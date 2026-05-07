import { afterEach, describe, expect, it, vi } from "vitest";

// 强制让 buffer 用一个固定的小容量,方便覆盖溢出场景。
vi.mock("../src/env.js", () => ({
  env: {
    NODE_ENV: "test",
    PORT: 8080,
    DATA_DIR: "./data",
    INITIAL_PASSWORD: "changeme",
    SESSION_SECRET: "test-secret-test-secret",
    LOG_LEVEL: "info",
    LOG_BUFFER_SIZE: 3,
  },
}));

import { logBuffer, ringStream } from "../src/log-buffer.js";

afterEach(() => {
  logBuffer._reset();
});

describe("LogBuffer", () => {
  it("snapshot 返回写入顺序,容量未满时不丢失", () => {
    logBuffer.push({ ts: 1, level: 30, levelLabel: "info", msg: "a", raw: "{}" });
    logBuffer.push({ ts: 2, level: 30, levelLabel: "info", msg: "b", raw: "{}" });
    expect(logBuffer.snapshot().map((e) => e.msg)).toEqual(["a", "b"]);
  });

  it("写满后覆盖最旧的条目", () => {
    logBuffer.push({ ts: 1, level: 30, levelLabel: "info", msg: "a", raw: "{}" });
    logBuffer.push({ ts: 2, level: 30, levelLabel: "info", msg: "b", raw: "{}" });
    logBuffer.push({ ts: 3, level: 30, levelLabel: "info", msg: "c", raw: "{}" });
    logBuffer.push({ ts: 4, level: 30, levelLabel: "info", msg: "d", raw: "{}" });
    expect(logBuffer.snapshot().map((e) => e.msg)).toEqual(["b", "c", "d"]);
  });

  it("订阅者收到广播,unsubscribe 后停止接收", () => {
    const seen: string[] = [];
    const off = logBuffer.subscribe((e) => seen.push(e.msg));
    logBuffer.push({ ts: 1, level: 30, levelLabel: "info", msg: "x", raw: "{}" });
    off();
    logBuffer.push({ ts: 2, level: 30, levelLabel: "info", msg: "y", raw: "{}" });
    expect(seen).toEqual(["x"]);
    expect(logBuffer.subscriberCount).toBe(0);
  });

  it("id 单调递增", () => {
    const e1 = logBuffer.push({ ts: 1, level: 30, levelLabel: "info", msg: "a", raw: "{}" });
    const e2 = logBuffer.push({ ts: 1, level: 30, levelLabel: "info", msg: "b", raw: "{}" });
    expect(e2.id).toBe(e1.id + 1);
  });
});

describe("ringStream", () => {
  it("把 pino JSON 行解析为结构化条目并入 buffer", () => {
    ringStream.write(`{"level":40,"time":1700000000000,"msg":"slow query"}\n`);
    const snap = logBuffer.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]).toMatchObject({
      level: 40,
      levelLabel: "warn",
      ts: 1700000000000,
      msg: "slow query",
    });
  });

  it("跨 chunk 半行能正确拼接", () => {
    ringStream.write(`{"level":30,"time":1,"msg":"hel`);
    expect(logBuffer.snapshot()).toHaveLength(0);
    ringStream.write(`lo"}\n{"level":30,"time":2,"msg":"world"}\n`);
    expect(logBuffer.snapshot().map((e) => e.msg)).toEqual(["hello", "world"]);
  });

  it("非 JSON 行兜底为 info,不静默丢失", () => {
    ringStream.write(`not-a-json-line\n`);
    const snap = logBuffer.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]?.levelLabel).toBe("info");
    expect(snap[0]?.msg).toBe("not-a-json-line");
  });

  it("ringStream 写入的 entry 拿到 buffer 分配的递增 id(不被占位 0 覆盖)", () => {
    ringStream.write(`{"level":30,"time":1,"msg":"a"}\n`);
    ringStream.write(`{"level":30,"time":2,"msg":"b"}\n`);
    const snap = logBuffer.snapshot();
    expect(snap).toHaveLength(2);
    expect(snap[0]?.id).toBeGreaterThan(0);
    expect(snap[1]?.id).toBe((snap[0]?.id ?? 0) + 1);
  });

  it("空行被跳过", () => {
    ringStream.write(`\n\n`);
    expect(logBuffer.snapshot()).toHaveLength(0);
  });
});
