import { useQuery } from "@tanstack/react-query";
import { CalendarClock, PauseCircle, X } from "lucide-react";
import { api } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

// 与 backend/src/schemas/provider.ts providerQuotaSchema 保持同步
export interface ProviderQuota {
  auto_exclude?: boolean;
  reset_day?: number;
  expire?: string;
  exhausted_until?: string;
}

// 与 backend/src/providers/quota.ts ProviderQuotaStatus 保持同步
export interface ProviderQuotaStatus {
  excluded: boolean;
  reason?: "expired" | "manual_exhausted" | "traffic_exhausted";
  restore_at?: number;
  traffic?: { used: number; total: number };
  traffic_source?: "upstream" | "info_node";
  expire_at?: number;
  expire_source?: "upstream" | "manual" | "info_node";
  next_reset_at?: number;
  reset_source?: "manual" | "info_node";
}

const REASON_LABEL: Record<NonNullable<ProviderQuotaStatus["reason"]>, string> = {
  expired: "已到期",
  manual_exhausted: "流量用完",
  traffic_exhausted: "流量用完",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function toLocalDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toShortDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// 与 backend/src/providers/quota.ts nextResetAt 同一套规则:严格晚于 now,当月没有这一天取月末
export function nextResetDate(resetDay: number, now = Date.now()): string {
  const base = new Date(now);
  for (let offset = 0; offset <= 1; offset++) {
    const year = base.getFullYear();
    const month = base.getMonth() + offset;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const candidate = new Date(year, month, Math.min(resetDay, lastDay));
    if (candidate.getTime() > now) return toLocalDate(candidate.getTime());
  }
  return toLocalDate(now);
}

/** 列表卡片右侧的状态徽标:被排除 / 命中但开关关着 */
export function QuotaBadge({ status }: { status?: ProviderQuotaStatus }) {
  if (!status?.reason) return null;
  const label = REASON_LABEL[status.reason];
  if (!status.excluded) {
    return (
      <Badge
        variant="outline"
        className="text-xs border-amber-500 text-amber-600 dark:text-amber-400"
        title="已关闭「自动排除」,节点照常输出"
      >
        {label}
      </Badge>
    );
  }
  const restore = status.restore_at !== undefined ? ` · ${toShortDate(status.restore_at)} 恢复` : "";
  return (
    <Badge
      variant="warning"
      className="text-xs flex items-center gap-1"
      title={
        status.restore_at !== undefined
          ? `生成订阅时已排除该源的节点,${toLocalDate(status.restore_at)} 起自动恢复`
          : status.reason === "traffic_exhausted"
            ? "生成订阅时已排除该源的节点;上游流量重置后,下次刷新(排除期间每小时一次)自动恢复"
            : "生成订阅时已排除该源的节点;续费后更新到期日即恢复"
      }
    >
      <PauseCircle className="h-3 w-3" /> 已排除 · {label}
      {restore}
    </Badge>
  );
}

/** 列表卡片里的一行流量 / 到期摘要;什么都没有时不渲染 */
export function QuotaSummary({ status }: { status?: ProviderQuotaStatus }) {
  if (!status) return null;
  const parts: string[] = [];
  const hints: string[] = [];
  if (status.traffic) {
    const pct = Math.round((status.traffic.used / status.traffic.total) * 100);
    parts.push(`流量 ${formatBytes(status.traffic.used)} / ${formatBytes(status.traffic.total)}`);
    hints.push(`已用 ${pct}%`);
  }
  if (status.expire_at !== undefined) {
    parts.push(`${toLocalDate(status.expire_at)} 到期`);
    if (status.expire_source === "info_node") hints.push("到期日来自订阅里的信息节点");
  }
  // 重置日总在一个月内,只写月/日
  if (status.next_reset_at !== undefined) parts.push(`${toShortDate(status.next_reset_at)} 重置`);
  if (parts.length === 0) return null;
  return (
    <div
      className="text-xs text-muted-foreground mt-1 flex items-center gap-1 min-w-0"
      title={hints.length > 0 ? hints.join(";") : undefined}
    >
      <CalendarClock className="h-3 w-3 shrink-0" />
      <span className="truncate">{parts.join(" · ")}</span>
    </div>
  );
}

interface EditorProps {
  providerId: string;
  isNew?: boolean;
  isInline: boolean;
  quota?: ProviderQuota;
  onChange: (quota: ProviderQuota | undefined) => void;
}

/** 节点源编辑页的「流量 / 到期」模块 */
export function QuotaEditor({ providerId, isNew, isInline, quota, onChange }: EditorProps) {
  // 复用列表页的 status 查询(同 queryKey),拿上游 userinfo 推出的流量 / 到期做只读展示
  const statusQuery = useQuery<{ items: { provider: { id: string }; quota?: ProviderQuotaStatus }[] }>({
    queryKey: ["providers", "status"],
    queryFn: () => api.get("/api/providers/status"),
    enabled: !isNew,
  });
  const upstream = statusQuery.data?.items.find((i) => i.provider.id === providerId)?.quota;
  const hasUpstreamTraffic = !!upstream?.traffic;
  const hasUpstreamExpire = upstream?.expire_source === "upstream";
  const infoExpire = upstream?.expire_source === "info_node" ? upstream.expire_at : undefined;
  // 上游给的值只存在 cache 里、每次刷新会变,所以不写进 yaml,只在输入框里显示出来
  const upstreamExpire = hasUpstreamExpire ? upstream?.expire_at : undefined;
  const infoReset = upstream?.reset_source === "info_node" ? upstream.next_reset_at : undefined;

  const q = quota ?? {};
  // 全是默认值时整个字段写 undefined,yaml 里不留空壳
  const set = (patch: Partial<ProviderQuota>) => {
    const next: ProviderQuota = { ...q, ...patch };
    for (const k of Object.keys(next) as (keyof ProviderQuota)[]) {
      if (next[k] === undefined || next[k] === "") delete next[k];
    }
    if (next.auto_exclude === true) delete next.auto_exclude;
    onChange(Object.keys(next).length > 0 ? next : undefined);
  };

  const today = toLocalDate(Date.now());
  const markedActive = !!q.exhausted_until && q.exhausted_until > today;
  const nextReset = q.reset_day
    ? nextResetDate(q.reset_day)
    : infoReset !== undefined
      ? toLocalDate(infoReset)
      : undefined;
  // 到期日输入框显示「当前生效」的值:上游 > 手填 > 信息节点。上游的只读;信息节点的灰显,改了就成手填
  const expireShown =
    upstreamExpire !== undefined
      ? toLocalDate(upstreamExpire)
      : (q.expire ?? (infoExpire !== undefined ? toLocalDate(infoExpire) : ""));
  const expireFromInfo = upstreamExpire === undefined && !q.expire && infoExpire !== undefined;

  return (
    <div className="space-y-3">
      {!isNew && (
        <div className="rounded-md border bg-muted/30 p-2.5 text-xs text-muted-foreground leading-relaxed">
          {hasUpstreamTraffic || hasUpstreamExpire ? (
            <>
              {upstream?.traffic_source === "info_node" ? "订阅信息节点(上次刷新):" : "上游数据(上次刷新):"}
              {upstream?.traffic && (
                <span className="font-medium text-foreground">
                  {" "}
                  已用 {formatBytes(upstream.traffic.used)} / {formatBytes(upstream.traffic.total)}
                </span>
              )}
              {upstreamExpire !== undefined && (
                <span className="font-medium text-foreground"> · {toLocalDate(upstreamExpire)} 到期</span>
              )}
              {infoReset !== undefined && (
                <span className="font-medium text-foreground"> · {toLocalDate(infoReset)} 重置</span>
              )}
              。流量用完时自动排除,上游重置后下次刷新即恢复(排除期间每小时重拉一次)。
            </>
          ) : isInline ? (
            <>
              静态节点拿不到实时流量:用完时在下面手动标记,到日子自动恢复。
              {infoExpire !== undefined && (
                <>
                  {" "}
                  订阅里的信息节点写着
                  <span className="font-medium text-foreground"> {toLocalDate(infoExpire)} 到期</span>
                  ,下面到期日留空就用它。
                </>
              )}
            </>
          ) : (
            "上游没有返回流量信息(Subscription-UserInfo):用完时在下面手动标记,到日子自动恢复。"
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Switch checked={q.auto_exclude !== false} onCheckedChange={(v) => set({ auto_exclude: v })} />
        <Label className="text-xs">流量用完或到期时,自动从生成的订阅中排除该源(关闭则只显示状态)</Label>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">
            每月流量重置日
            {!q.reset_day && infoReset !== undefined ? "(留空 = 用订阅信息的倒计时)" : ""}
          </Label>
          <Input
            className="mt-1"
            type="number"
            min={1}
            max={31}
            value={q.reset_day ?? ""}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10);
              set({ reset_day: Number.isNaN(n) ? undefined : Math.max(1, Math.min(31, n)) });
            }}
            placeholder={
              infoReset !== undefined
                ? `订阅信息:下次 ${toLocalDate(infoReset)} 重置`
                : "如 2(当月没有这天按月末)"
            }
          />
        </div>
        <div>
          <Label className="text-xs">
            到期日
            {upstreamExpire !== undefined
              ? "(上游提供,每次刷新自动更新)"
              : expireFromInfo
                ? "(来自订阅信息节点,改了以手填为准)"
                : ""}
          </Label>
          <Input
            className={cn("mt-1", expireFromInfo && "text-muted-foreground")}
            type="date"
            value={expireShown}
            disabled={upstreamExpire !== undefined}
            title={upstreamExpire !== undefined ? "上游 Subscription-UserInfo 带了到期时间,以上游为准" : undefined}
            onChange={(e) => set({ expire: e.target.value || undefined })}
          />
          {upstreamExpire !== undefined && q.expire && (
            <p className="text-xs text-muted-foreground mt-1">
              手填的 {q.expire} 不生效。
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => set({ expire: undefined })}
              >
                清除
              </button>
            </p>
          )}
        </div>
      </div>

      <div
        className={cn(
          "rounded-md border p-2.5 space-y-2",
          markedActive && "border-amber-500/40 bg-amber-500/10",
        )}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-medium">
            {markedActive ? `已标记流量用完,排除到 ${q.exhausted_until}(当天零点恢复)` : "手动标记流量用完"}
          </span>
          {markedActive && (
            <Button type="button" variant="ghost" size="sm" onClick={() => set({ exhausted_until: undefined })}>
              <X className="h-3.5 w-3.5" />
              取消标记
            </Button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!nextReset}
            title={nextReset ? undefined : "先填每月重置日,或直接在右边选日期"}
            onClick={() => nextReset && set({ exhausted_until: nextReset })}
          >
            <PauseCircle className="h-3.5 w-3.5" />
            {nextReset ? `排除到下个重置日(${nextReset})` : "排除到下个重置日"}
          </Button>
          <span className="text-xs text-muted-foreground">或排除到</span>
          <Input
            type="date"
            className="h-8 w-40"
            min={today}
            value={q.exhausted_until ?? ""}
            onChange={(e) => set({ exhausted_until: e.target.value || undefined })}
          />
        </div>
        <p className="text-xs text-muted-foreground">保存后生效。客户端要更新托管配置才会看到节点变化。</p>
      </div>
    </div>
  );
}
