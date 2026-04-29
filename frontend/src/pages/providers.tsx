import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, AlertCircle, CheckCircle2, Clock, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEntityList, useDeleteEntity } from "@/api/entities";
import { EntityYamlDialog } from "@/components/entity-yaml-dialog";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

interface Provider {
  id: string;
  name: string;
  type: "http" | "file" | "inline";
  url?: string;
  path?: string;
  enabled: boolean;
  refresh: { interval_minutes: number; on_demand: boolean };
}

interface ProviderStatusItem {
  provider: Provider;
  status?: "ok" | "stale" | "error";
  node_count: number;
  fetched_at?: number;
  error?: string;
}

export function ProvidersPage() {
  const list = useEntityList<Provider>("providers");
  const del = useDeleteEntity("providers");
  const status = useQuery<{ items: ProviderStatusItem[] }>({
    queryKey: ["providers", "status"],
    queryFn: () => api.get("/api/providers/status"),
    refetchInterval: 30_000,
  });
  const queryClient = useQueryClient();
  const refreshAll = useMutation({
    mutationFn: () => api.post("/api/providers/refresh-all"),
    onSuccess: () => {
      toast({ title: "已触发刷新", variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["providers", "status"] });
    },
  });
  const refreshOne = useMutation({
    mutationFn: (id: string) => api.post(`/api/providers/${id}/refresh`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers", "status"] });
    },
  });

  const [editing, setEditing] = useState<Provider | null>(null);
  const [open, setOpen] = useState(false);

  const statusMap = new Map(status.data?.items.map((i) => [i.provider.id, i]) ?? []);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">节点源 (Providers)</h1>
          <p className="text-muted-foreground mt-1">订阅 URL / 本地节点文件 / 内联节点; 多源去重合并</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refreshAll.mutate()} disabled={refreshAll.isPending}>
            <RefreshCw className={refreshAll.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            全部刷新
          </Button>
          <Button
            onClick={() => {
              setEditing(null);
              setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            新建
          </Button>
        </div>
      </div>

      {list.data && list.data.items.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          暂无节点源,点击右上角「新建」添加
        </div>
      )}

      <div className="grid gap-3">
        {list.data?.items.map((p) => {
          const s = statusMap.get(p.id);
          return (
            <Card key={p.id} className="p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{p.name}</span>
                    <Badge variant="outline" className="text-xs">
                      {p.type}
                    </Badge>
                    {!p.enabled && <Badge variant="secondary" className="text-xs">已禁用</Badge>}
                    {s?.status === "ok" && (
                      <Badge variant="success" className="text-xs flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> {s.node_count} 个节点
                      </Badge>
                    )}
                    {s?.status === "stale" && (
                      <Badge variant="warning" className="text-xs flex items-center gap-1">
                        <Clock className="h-3 w-3" /> 使用旧缓存
                      </Badge>
                    )}
                    {s?.status === "error" && (
                      <Badge variant="destructive" className="text-xs flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" /> 失败
                      </Badge>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1 truncate">
                    {p.url ?? p.path ?? "inline"}
                  </div>
                  {s?.fetched_at && (
                    <div className="text-xs text-muted-foreground mt-1">
                      上次刷新: {new Date(s.fetched_at).toLocaleString()} · 刷新周期: {p.refresh.interval_minutes} 分钟
                    </div>
                  )}
                  {s?.error && (
                    <div className="text-xs text-destructive mt-1">错误: {s.error}</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => refreshOne.mutate(p.id)}
                    disabled={refreshOne.isPending}
                    title="刷新此源"
                  >
                    <RefreshCw className={refreshOne.isPending && refreshOne.variables === p.id ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                      setEditing(p);
                      setOpen(true);
                    }}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={async () => {
                      if (!window.confirm(`删除 ${p.name}?`)) return;
                      await del.mutateAsync(p.id);
                      toast({ title: "已删除", variant: "success" });
                    }}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <EntityYamlDialog<Provider>
        kind="providers"
        entity={editing}
        open={open}
        onOpenChange={setOpen}
        defaultId={editing?.id ?? `provider-${Date.now().toString(36)}`}
        templateValue={{
          name: "新机场",
          type: "http",
          url: "https://example.com/subscribe?token=xxx",
          user_agent: "Surge/2400",
          refresh: { interval_minutes: 60, on_demand: true },
          parser_hint: "auto",
          enabled: true,
          tags: [],
        } as Partial<Provider>}
      />
    </div>
  );
}
