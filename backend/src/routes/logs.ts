import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { logBuffer, type LogEntry } from "../log-buffer.js";

/**
 * 日志 SSE 路由。
 *
 * GET /api/logs/stream
 *   - 连接建立后先推送 ring buffer 中的全部历史(每条 event: log),
 *     然后发一个 event: backlog-end 标记,后续进入实时增量推送。
 *   - 每 25s 在没有新日志时推一条 event: ping,防止反向代理空闲断连。
 *   - 客户端断开(EventSource.close 或网络中断)时通过 AbortSignal
 *     释放订阅 + 定时器,不会泄漏。
 */
const PING_MS = 25_000;

export const logsRouter = new Hono();

logsRouter.get("/stream", (c) => {
  return streamSSE(c, async (stream) => {
    const signal = c.req.raw.signal;

    const sendEntry = (entry: LogEntry) =>
      stream.writeSSE({
        event: "log",
        data: JSON.stringify(entry),
        id: String(entry.id),
      });

    for (const entry of logBuffer.snapshot()) {
      if (signal.aborted) return;
      await sendEntry(entry);
    }
    if (signal.aborted) return;
    await stream.writeSSE({ event: "backlog-end", data: String(Date.now()) });

    const queue: LogEntry[] = [];
    let resolveNext: (() => void) | null = null;
    const wake = () => {
      const r = resolveNext;
      resolveNext = null;
      r?.();
    };
    const unsubscribe = logBuffer.subscribe((entry) => {
      queue.push(entry);
      wake();
    });
    signal.addEventListener("abort", wake, { once: true });

    const pingTimer = setInterval(wake, PING_MS);

    try {
      let lastSendAt = Date.now();
      while (!signal.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            resolveNext = resolve;
          });
        }
        while (queue.length > 0 && !signal.aborted) {
          const entry = queue.shift()!;
          await sendEntry(entry);
          lastSendAt = Date.now();
        }
        if (!signal.aborted && Date.now() - lastSendAt >= PING_MS) {
          await stream.writeSSE({ event: "ping", data: String(Date.now()) });
          lastSendAt = Date.now();
        }
      }
    } finally {
      clearInterval(pingTimer);
      unsubscribe();
    }
  });
});
