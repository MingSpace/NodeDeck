import { cn, formatBytes } from "@/lib/utils";
import { toLocalDate, toShortDate, type ProviderQuotaStatus } from "./quota";

const DAY_MS = 86_400_000;

// 上一个重置日 = 下一个重置日往前推一个月;当月没有这一天取月末(与 quota.ts nextResetDate 同规则)
function previousResetAt(nextResetAt: number): number {
  const d = new Date(nextResetAt);
  const year = d.getFullYear();
  const month = d.getMonth() - 1;
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(d.getDate(), lastDay)).getTime();
}

interface CyclePace {
  /** 本周期已过去的时间比例 0~1 */
  elapsed: number;
  /** 照当前用量速度,预计用完的时间;赶得上重置日则为 undefined */
  runOutAt?: number;
}

function cyclePace(status: ProviderQuotaStatus, now: number): CyclePace | undefined {
  const t = status.traffic;
  if (!t || status.next_reset_at === undefined) return undefined;
  const start = previousResetAt(status.next_reset_at);
  const span = status.next_reset_at - start;
  if (span <= 0 || now < start) return undefined;
  const elapsed = Math.min(1, (now - start) / span);
  // 周期刚开始几天的速度没参考价值,不做推算
  if (elapsed < 0.1 || t.used <= 0 || t.used >= t.total) return { elapsed };
  const runOutAt = start + (now - start) * (t.total / t.used);
  return { elapsed, runOutAt: runOutAt < status.next_reset_at ? runOutAt : undefined };
}

/** 流量条:已用比例 + 本周期时间进度刻度,用得比时间快时推算用完日期 */
export function TrafficMeter({
  status,
  emptyHint,
}: {
  status?: ProviderQuotaStatus;
  /** 没有流量数据时在列里显示的说明;不传则留空 */
  emptyHint?: string;
}) {
  const t = status?.traffic;
  if (!status || !t || t.total <= 0) {
    // 宽屏下各格直接落进外层列模板,空格也要占位,否则后面的格子会往前挪一列
    return <div className="text-xs text-muted-foreground/70">{emptyHint}</div>;
  }
  const now = Date.now();
  const ratio = Math.min(1, t.used / t.total);
  const pct = Math.round(ratio * 100);
  const pace = cyclePace(status, now);
  const exhausted = ratio >= 1 || status.reason === "traffic_exhausted" || status.reason === "manual_exhausted";
  const warn = exhausted || ratio >= 0.9 || pace?.runOutAt !== undefined;

  const resetText =
    status.next_reset_at !== undefined
      ? `${toShortDate(status.next_reset_at)} 重置 · ${Math.max(1, Math.ceil((status.next_reset_at - now) / DAY_MS))} 天后`
      : undefined;

  return (
    <div
      className="min-w-0"
      title={
        pace
          ? `已用 ${pct}%,本周期已过 ${Math.round(pace.elapsed * 100)}%(竖线位置)`
          : `已用 ${pct}%`
      }
    >
      <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
        <span className="truncate">
          <span className={cn("font-medium", warn ? "text-amber-600 dark:text-amber-400" : "text-foreground")}>
            {formatBytes(t.used)}
          </span>
          <span className="text-muted-foreground"> / {formatBytes(t.total)}</span>
        </span>
        <span className={cn("shrink-0", warn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>
          {pct}%
        </span>
      </div>
      <div className="relative mt-1.5 h-1.5 rounded-full bg-secondary">
        <div
          className={cn("h-full rounded-full", warn ? "bg-amber-500" : "bg-emerald-500")}
          style={{ width: `${ratio * 100}%` }}
        />
        {pace && !exhausted && (
          <div
            aria-hidden
            className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70 ring-2 ring-card"
            style={{ left: `${pace.elapsed * 100}%` }}
          />
        )}
      </div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {pace?.runOutAt !== undefined ? (
          <span className="text-amber-600 dark:text-amber-400">
            照此速度约 {toShortDate(pace.runOutAt)} 用完
            {resetText && <span className="text-muted-foreground"> · {toShortDate(status.next_reset_at!)} 重置</span>}
          </span>
        ) : (
          (resetText ?? (exhausted ? "流量已用完" : "无重置日"))
        )}
      </div>
    </div>
  );
}

/** 到期列:剩余天数 + 日期 */
export function ExpiryCell({ status }: { status?: ProviderQuotaStatus }) {
  // 空格占位,理由同 TrafficMeter
  if (status?.expire_at === undefined) return <div aria-hidden />;
  const days = Math.ceil((status.expire_at - Date.now()) / DAY_MS);
  const expired = days <= 0;
  const soon = !expired && days <= 7;
  return (
    <div
      className="min-w-0"
      title={status.expire_source === "info_node" ? "到期日来自订阅里的信息节点" : undefined}
    >
      <div
        className={cn(
          "text-base font-semibold leading-tight tabular-nums",
          expired ? "text-destructive" : soon ? "text-amber-600 dark:text-amber-400" : "text-foreground",
        )}
      >
        {expired ? "已到期" : (
          <>
            {days}
            <span className="ml-0.5 text-xs font-normal text-muted-foreground">天</span>
          </>
        )}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">{toLocalDate(status.expire_at)}</div>
    </div>
  );
}

/** 节点列:节点数;沿用旧节点 / 0 个节点时变黄,没拉到过时显示横线 */
export function NodeCountCell({
  count,
  tone,
  title,
}: {
  count?: number;
  tone: "normal" | "warn" | "muted";
  title?: string;
}) {
  return (
    <div className="min-w-0" title={title}>
      <div
        className={cn(
          "text-base font-semibold leading-tight tabular-nums",
          tone === "warn" && "text-amber-600 dark:text-amber-400",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {count ?? "—"}
      </div>
      <div className="mt-0.5 text-xs text-muted-foreground">节点</div>
    </div>
  );
}

export type ProviderHealth = "ok" | "warn" | "error" | "off" | "pending";

const HEALTH_DOT: Record<ProviderHealth, { className: string; label: string }> = {
  ok: { className: "bg-emerald-500", label: "正常" },
  warn: { className: "bg-amber-500", label: "需要留意" },
  error: { className: "bg-destructive", label: "拉取失败" },
  off: { className: "bg-zinc-400 dark:bg-zinc-500", label: "已禁用" },
  pending: { className: "bg-amber-400 animate-pulse", label: "正在拉取" },
};

/** 名字前的状态圆点:正常时只有它,不再额外挂徽标 */
export function HealthDot({ health }: { health: ProviderHealth }) {
  const { className, label } = HEALTH_DOT[health];
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn("inline-block h-2 w-2 shrink-0 rounded-full", className)}
    />
  );
}
