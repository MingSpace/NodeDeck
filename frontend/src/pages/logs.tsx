import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, ScrollText, Trash2, Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLogStream, type LogEntry, type StreamStatus } from "@/api/logs";
import { cn } from "@/lib/utils";

const LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_NUM: Record<Level, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function LogsPage() {
  const { entries, status, clear } = useLogStream();
  const [minLevel, setMinLevel] = useState<Level>("trace");
  const [filter, setFilter] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const endRef = useRef<HTMLDivElement>(null);

  const minLevelNum = LEVEL_NUM[minLevel];
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.level < minLevelNum) return false;
      if (!f) return true;
      return (
        e.msg.toLowerCase().includes(f) || e.raw.toLowerCase().includes(f)
      );
    });
  }, [entries, minLevelNum, filter]);

  useEffect(() => {
    if (autoScroll) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [visible.length, autoScroll]);

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onClear = () => {
    clear();
    setExpanded(new Set());
  };

  return (
    <div className="flex flex-col h-screen p-6 max-w-[1600px]">
      <header className="mb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">日志</h1>
        <p className="text-sm text-muted-foreground mt-1">
          实时进程日志(内存,重启清空)
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 mb-3 shrink-0">
        <StatusBadge status={status} />
        <Select value={minLevel} onValueChange={(v) => setMinLevel(v as Level)}>
          <SelectTrigger className="w-32">
            <SelectValue placeholder="级别" />
          </SelectTrigger>
          <SelectContent>
            {LEVELS.map((l) => (
              <SelectItem key={l} value={l}>
                ≥ {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="文本过滤..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => setAutoScroll((s) => !s)}
        >
          {autoScroll ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {autoScroll ? "暂停滚动" : "继续滚动"}
        </Button>
        <Button variant="outline" size="sm" onClick={onClear}>
          <Trash2 className="h-4 w-4" />
          清屏
        </Button>
        <span className="text-xs text-muted-foreground ml-auto tabular-nums">
          {visible.length} / {entries.length} 条
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto rounded-md border bg-card font-mono text-xs">
        {visible.length === 0 ? (
          <div className="p-12 text-center text-muted-foreground">
            <ScrollText className="h-8 w-8 mx-auto opacity-40 mb-2" />
            {entries.length === 0 ? "等待日志..." : "无匹配项"}
          </div>
        ) : (
          <div className="p-2">
            {visible.map((entry) => (
              <LogRow
                key={entry.id}
                entry={entry}
                expanded={expanded.has(entry.id)}
                onToggle={() => toggleExpand(entry.id)}
              />
            ))}
            <div ref={endRef} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: StreamStatus }) {
  if (status === "open") {
    return (
      <Badge variant="success" className="gap-1">
        <Wifi className="h-3 w-3" /> 已连接
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="destructive" className="gap-1">
        <WifiOff className="h-3 w-3" /> 已断开,重连中
      </Badge>
    );
  }
  return <Badge variant="secondary">连接中...</Badge>;
}

interface LogRowProps {
  entry: LogEntry;
  expanded: boolean;
  onToggle: () => void;
}

function LogRow({ entry, expanded, onToggle }: LogRowProps) {
  return (
    <div
      onClick={onToggle}
      className="cursor-pointer rounded px-2 py-1 hover:bg-secondary/50"
    >
      <div className="flex items-start gap-2">
        <span className="text-muted-foreground tabular-nums shrink-0">
          {formatTs(entry.ts)}
        </span>
        <LevelTag label={entry.levelLabel} />
        <span className="break-all whitespace-pre-wrap min-w-0 flex-1">
          {entry.msg || "(empty msg)"}
        </span>
      </div>
      {expanded && (
        <pre className="mt-1 ml-4 p-2 bg-muted/40 rounded text-[11px] leading-relaxed whitespace-pre-wrap break-all">
          {prettify(entry.raw)}
        </pre>
      )}
    </div>
  );
}

const LEVEL_CLASS: Record<string, string> = {
  trace: "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  debug: "bg-sky-200 text-sky-800 dark:bg-sky-900 dark:text-sky-200",
  info: "bg-emerald-200 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  warn: "bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  error: "bg-red-200 text-red-800 dark:bg-red-900 dark:text-red-200",
  fatal: "bg-red-600 text-white",
};

function LevelTag({ label }: { label: string }) {
  return (
    <span
      className={cn(
        "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide leading-none mt-0.5",
        LEVEL_CLASS[label] ?? "bg-zinc-200 text-zinc-700",
      )}
    >
      {label}
    </span>
  );
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function prettify(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
