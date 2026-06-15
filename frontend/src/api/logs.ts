import { useEffect, useRef, useState } from "react";

export type LogLevelLabel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface LogEntry {
  id: number;
  ts: number;
  level: number;
  levelLabel: LogLevelLabel | string;
  msg: string;
  raw: string;
}

export type StreamStatus = "connecting" | "open" | "error";

interface UseLogStreamResult {
  entries: LogEntry[];
  status: StreamStatus;
  clear: () => void;
}

/**
 * 订阅 /api/logs/stream(SSE)。
 * 容量上限默认 5000,超出截断最旧的(后端 ring buffer 默认 2000,这里给 2.5x 余量)。
 * 浏览器 EventSource 自带断线自动重连,无需手动处理。
 */
export function useLogStream(maxEntries = 5000): UseLogStreamResult {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/logs/stream", { withCredentials: true });
    esRef.current = es;

    const handleOpen = () => setStatus("open");
    const handleError = () => setStatus("error");

    const handleLog = (ev: MessageEvent<string>) => {
      let entry: LogEntry;
      try {
        entry = JSON.parse(ev.data) as LogEntry;
      } catch {
        return;
      }
      setEntries((prev) => {
        if (prev.length < maxEntries) return [...prev, entry];
        const dropped = prev.length - maxEntries + 1;
        return [...prev.slice(dropped), entry];
      });
    };

    es.addEventListener("open", handleOpen);
    es.addEventListener("error", handleError);
    es.addEventListener("log", handleLog as EventListener);

    return () => {
      es.removeEventListener("open", handleOpen);
      es.removeEventListener("error", handleError);
      es.removeEventListener("log", handleLog as EventListener);
      es.close();
      esRef.current = null;
    };
  }, [maxEntries]);

  const clear = () => setEntries([]);

  return { entries, status, clear };
}
