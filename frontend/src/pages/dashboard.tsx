import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, AlertCircle, CheckCircle2, Clock, Calendar, Database, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

interface AirportItem {
  id: string;
  name: string;
  type: string;
  url?: string;
  enabled: boolean;
  status: "ok" | "stale" | "error" | "unknown";
  node_count: number;
  fetched_at?: number;
  error?: string;
  userinfo?: { upload: number; download: number; total: number; expire: number };
  raw_userinfo_header?: string;
}

interface DashboardSummary {
  providers: number;
  profiles: number;
}

export function DashboardPage() {
  const queryClient = useQueryClient();
  const summary = useQuery<DashboardSummary>({
    queryKey: ["dashboard", "summary"],
    queryFn: () => api.get("/api/dashboard/summary"),
  });
  const airports = useQuery<{ items: AirportItem[] }>({
    queryKey: ["dashboard", "airports"],
    queryFn: () => api.get("/api/dashboard/airports"),
    refetchInterval: 60_000,
  });
  const refreshOne = useMutation({
    mutationFn: (id: string) => api.post(`/api/providers/${id}/refresh`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  });
  const refreshAll = useMutation({
    mutationFn: () => api.post("/api/providers/refresh-all"),
    onSuccess: () => {
      toast({ title: "已触发刷新", variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });

  return (
    <div className="p-8 max-w-7xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">仪表板</h1>
          <p className="text-muted-foreground mt-1">机场状态与流量信息</p>
        </div>
        <Button variant="outline" onClick={() => refreshAll.mutate()} disabled={refreshAll.isPending}>
          <RefreshCw className={refreshAll.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          全部刷新
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <StatCard icon={<Database className="h-5 w-5" />} label="Providers" value={summary.data?.providers ?? "-"} />
        <StatCard icon={<Layers className="h-5 w-5" />} label="Profiles" value={summary.data?.profiles ?? "-"} />
        <StatCard
          icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
          label="健康机场"
          value={airports.data?.items.filter((a) => a.status === "ok").length ?? "-"}
        />
        <StatCard
          icon={<AlertCircle className="h-5 w-5 text-destructive" />}
          label="异常机场"
          value={airports.data?.items.filter((a) => a.status === "error" || a.status === "stale").length ?? "-"}
        />
      </div>

      <h2 className="text-sm font-medium text-muted-foreground mb-2">机场列表</h2>
      {airports.data && airports.data.items.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          暂无机场,前往「节点源」页面添加
        </div>
      )}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
        {airports.data?.items.map((a) => (
          <AirportCard key={a.id} airport={a} onRefresh={() => refreshOne.mutate(a.id)} refreshing={refreshOne.isPending && refreshOne.variables === a.id} />
        ))}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-3">
        <div className="rounded-md bg-secondary/60 p-2">{icon}</div>
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="text-2xl font-bold">{value}</div>
        </div>
      </div>
    </Card>
  );
}

function AirportCard({
  airport,
  onRefresh,
  refreshing,
}: {
  airport: AirportItem;
  onRefresh: () => void;
  refreshing: boolean;
}) {
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
        <Badge variant="warning">
          <Clock className="h-3 w-3" /> 旧缓存
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

  return (
    <Card className={`p-4 ${expireWarn || trafficWarn ? "border-amber-300" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium truncate">{airport.name}</span>
            {statusBadge}
            {!airport.enabled && <Badge variant="secondary">已禁用</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{airport.id} · {airport.node_count} 节点</div>
        </div>
        <Button size="icon" variant="ghost" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw className={refreshing ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      {ui && (
        <div className="mt-3 space-y-2">
          {totalBytes > 0 ? (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">流量</span>
                <span className={trafficWarn ? "text-amber-600 font-medium" : ""}>
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
            <div className={`flex items-center gap-1.5 text-xs ${expireWarn ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
              <Calendar className="h-3 w-3" />
              {daysLeft > 0 ? `还剩 ${daysLeft} 天` : "已过期"} · {new Date(expireSec * 1000).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {airport.fetched_at && (
        <div className="mt-3 text-xs text-muted-foreground">
          上次刷新: {new Date(airport.fetched_at).toLocaleString()}
        </div>
      )}
      {airport.error && (
        <div className="mt-2 text-xs text-destructive bg-destructive/10 rounded p-2 line-clamp-2">{airport.error}</div>
      )}
    </Card>
  );
}

function formatBytes(b: number): string {
  if (b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}
