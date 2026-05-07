import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { logsRouter } from "../../src/routes/logs.js";
import { logBuffer } from "../../src/log-buffer.js";

function buildApp(): Hono {
  const app = new Hono();
  app.route("/api/logs", logsRouter);
  return app;
}

/**
 * 持续读 SSE 直到 buf 包含 marker 或超过 timeoutMs。
 *
 * 备注: 在 vitest 的 fetch 合成环境下,Hono streamSSE 的 cb 中 `await writeSSE`
 * 与外层 reader.read() 之间存在 microtask 调度顺序差异 —— reader 拿到 chunk 后,
 * cb 那边的 writeSSE promise 可能还没 resolve。生产环境(@hono/node-server +
 * 真实 HTTP socket)不存在此问题。所以这里 read 之后让出一个 macrotask,确保 cb 能
 * 推进到下一个 await 点。
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  marker: string,
  timeoutMs = 2000,
): Promise<string> {
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + timeoutMs;
  while (!buf.includes(marker)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      throw new Error(
        `timeout waiting for "${marker}", got ${buf.length} bytes: ${JSON.stringify(buf.slice(-300))}`,
      );
    }
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), remaining),
      ),
    ]);
    if (result.done) break;
    if (result.value) buf += decoder.decode(result.value, { stream: true });
    await new Promise((r) => setTimeout(r, 0));
  }
  return buf;
}

afterEach(() => {
  logBuffer._reset();
});

describe("GET /api/logs/stream", () => {
  it("返回 SSE Content-Type", async () => {
    const app = buildApp();
    const abort = new AbortController();
    const res = await app.fetch(
      new Request("http://test/api/logs/stream", { signal: abort.signal }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    abort.abort();
    try {
      await res.body?.cancel();
    } catch {
      // 忽略 cancel 抛出的 AbortError
    }
  });

  it("先推送 backlog 再发 backlog-end,随后能收到增量", async () => {
    logBuffer.push({
      ts: 1,
      level: 30,
      levelLabel: "info",
      msg: "before-connect",
      raw: '{"msg":"before-connect"}',
    });

    const app = buildApp();
    const abort = new AbortController();
    const res = await app.fetch(
      new Request("http://test/api/logs/stream", { signal: abort.signal }),
    );
    const reader = res.body!.getReader();

    const backlogText = await readUntil(reader, "backlog-end", 3000);
    expect(backlogText).toContain("event: log");
    expect(backlogText).toContain("before-connect");
    expect(backlogText).toContain("event: backlog-end");

    // 让 cb 进入 while loop 的 await(等待新条目)
    await new Promise((r) => setTimeout(r, 20));

    logBuffer.push({
      ts: 2,
      level: 40,
      levelLabel: "warn",
      msg: "after-connect",
      raw: '{"msg":"after-connect"}',
    });

    const incrementalText = await readUntil(reader, "after-connect", 3000);
    expect(incrementalText).toContain("after-connect");

    abort.abort();
    try {
      await reader.cancel();
    } catch {
      // 忽略
    }
  });
});
