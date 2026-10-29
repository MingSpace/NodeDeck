import { AlertCircle, Ban, Calendar, Clock, Cloud, CloudOff, FileText, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshedAt } from "@/components/refreshed-at";
import { FetchErrorLine } from "@/components/fetch-error-line";
import { cn, formatBytes } from "@/lib/utils";
import type { AirportItem, ProviderType } from "./types";

const PROVIDER_TYPE_ICON: Record<
  ProviderType,
  { Icon: LucideIcon; label: string }
> = {
  http: { Icon: Cloud, label: "URL 订阅" },
  inline: { Icon: FileText, label: "静态节点" },
  file: { Icon: FileText, label: "静态节点" },
};

export function AirportCard({ airport }: { airport: AirportItem }) {
  const ui = airport.userinfo;
  const usedBytes = ui ? ui.upload + ui.download : 0;
  const totalBytes = ui?.total ?? 0;
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  const remainPercent = 100 - usedPercent;

  const expireSec = ui?.expire ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const daysLeft = expireSec > 0 ? Math.ceil((expireSec - nowSec) / 86400) : null;

  const expireWarn = daysLeft !== null && daysLeft <= 7;
  const trafficWarn = totalBytes > 0 && remainPercent <= 10;

  const statusBadge = (() => {
    if (airport.status === "ok") return <Badge variant="success">健康</Badge>;
    if (airport.status === "stale")
      return (
        <Badge
          variant="warning"
          title={`没拉到新的,沿用上次拉到的 ${airport.node_count} 个节点`}
        >
          {airport.offline ? <CloudOff className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
          {airport.offline ? "离线" : "沿用旧节点"}
        </Badge>
      );
    if (airport.status === "error")
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3" /> 失败
        </Badge>
      );
    return <Badge variant="secondary">未知</Badge>;
  })();

  const { Icon: TypeIcon, label: typeLabel } =
    PROVIDER_TYPE_ICON[airport.type] ?? PROVIDER_TYPE_ICON.http;

  return (
    <Card
      className={cn(
        "p-4 transition-opacity",
        expireWarn || trafficWarn ? "border-amber-300 dark:border-amber-700" : "",
        !airport.enabled && "opacity-60 bg-muted/20 hover:opacity-100",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "font-medium truncate",
                !airport.enabled && "line-through decoration-1",
              )}
            >
              {airport.name}
            </span>
            {statusBadge}
            {!airport.enabled && (
              <Badge variant="disabled" className="flex items-center gap-1">
                <Ban className="h-3 w-3" /> 已禁用
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5" title={`id: ${airport.id}`}>
            {airport.node_count} 个节点
          </div>
        </div>
        <div
          className="text-muted-foreground shrink-0"
          aria-label={typeLabel}
          title={typeLabel}
        >
          <TypeIcon className="h-5 w-5" />
        </div>
      </div>

      {ui && (
        <div className="mt-3 space-y-2">
          {totalBytes > 0 ? (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">流量</span>
                <span className={trafficWarn ? "text-amber-600 dark:text-amber-400 font-medium" : ""}>
                  {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full ${trafficWarn ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(usedPercent, 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">无流量限额信息</div>
          )}
          {daysLeft !== null && (
            <div className={`flex items-center gap-1.5 text-xs ${expireWarn ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}>
              <Calendar className="h-3 w-3" />
              {daysLeft > 0 ? `还剩 ${daysLeft} 天` : "已过期"} · {new Date(expireSec * 1000).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {airport.fetched_at && (
        <div className="mt-3 text-xs text-muted-foreground">
          {/* stale 的 fetched_at 是沿用的那份 cache 的时间,也就是最后一次成功 */}
          {airport.status === "stale" ? "上次成功" : "上次刷新"} <RefreshedAt ts={airport.fetched_at} />
        </div>
      )}
      {airport.error && (
        <FetchErrorLine
          className="mt-1.5"
          error={airport.error}
          tone={airport.status === "stale" ? "stale" : "error"}
          to={`/providers?focus=${encodeURIComponent(airport.id)}`}
        />
      )}
    </Card>
  );
}
