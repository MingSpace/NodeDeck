import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Clock,
  Edit,
  Trash2,
  ChevronDown,
  Search,
  Ban,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NodeRow, type NodeBrief } from "@/components/node-row";
import { RefreshedAt } from "@/components/refreshed-at";
import { useEntityList, useDeleteEntity } from "@/api/entities";
import { EntityVisualDialog } from "@/components/entity-visual-dialog";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import {
  ProviderVisualForm,
  DEFAULT_PROVIDER_TEMPLATE,
  type ProviderData,
  type RefreshInterval,
} from "./visual-form";

interface ProviderNodesResp {
  provider_id: string;
  count: number;
  fetched_at: number;
  nodes: NodeBrief[];
}

// @business_rule: 列表里的订阅 URL 经常带一长串 query (token / filename / 嵌套 url),
// 完整展示会撑爆卡片;此处只显示 host + path,query 数量用徽标提示,完整 URL 走 hover title。
function formatUrlDisplay(raw: string): { text: string; queryCount: number } {
  try {
    const u = new URL(raw);
    const path = u.pathname === "/" ? "" : u.pathname;
    const queryCount = u.search ? Array.from(u.searchParams.keys()).length : 0;
    return { text: `${u.host}${path}`, queryCount };
  } catch {
    return { text: raw, queryCount: 0 };
  }
}

const REFRESH_INTERVAL_LABEL: Record<RefreshInterval, string> = {
  never: "永不刷新",
  "4h": "每 4 小时",
  "12h": "每 12 小时",
  "24h": "每 24 小时",
  "1week": "每周",
  on_request: "每次调用时",
};

interface ProviderStatusItem {
  provider: ProviderData;
  cached: boolean;
  status?: "ok" | "stale" | "error";
  node_count: number;
  fetched_at?: number;
  error?: string;
}

export function ProvidersPage() {
  const list = useEntityList<ProviderData>("providers");
  const del = useDeleteEntity("providers");
  const status = useQuery<{ items: ProviderStatusItem[] }>({
    queryKey: ["providers", "status"],
    queryFn: () => api.get("/api/providers/status"),
    // 有未拉取的 enabled provider(刚新建,后台 fetch 还没回来)时短轮询,
    // 让用户几秒内看到 ok/error;稳态后回到 30s。
    refetchInterval: (query) => {
      const items = query.state.data?.items ?? [];
      const hasPending = items.some((i) => i.provider.enabled && !i.cached);
      return hasPending ? 3_000 : 30_000;
    },
  });
  const queryClient = useQueryClient();
  const refreshAll = useMutation({
    mutationFn: () =>
      api.post<{ count: number; skipped_locked: string[] }>(
        "/api/providers/refresh-all",
      ),
    onSuccess: (data) => {
      const skipped = data?.skipped_locked?.length ?? 0;
      toast({
        title: "已触发刷新",
        description:
          skipped > 0
            ? `刷新 ${data?.count ?? 0} 个,跳过 ${skipped} 个永久缓存`
            : `刷新 ${data?.count ?? 0} 个`,
        variant: "success",
      });
      queryClient.invalidateQueries({ queryKey: ["providers", "status"] });
    },
  });
  const refreshOne = useMutation({
    mutationFn: (id: string) => api.post(`/api/providers/${id}/refresh`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["providers", "status"] });
    },
    onError: (err: Error) => {
      const msg = err.message ?? "";
      if (msg.includes("locked")) {
        toast({
          title: "Provider 已锁定",
          description: "interval=never,需在编辑器中临时改为其他选项才能刷新",
          variant: "info",
        });
      } else {
        toast({ title: "刷新失败", description: msg, variant: "error" });
      }
    },
  });

  const [editing, setEditing] = useState<ProviderData | null>(null);
  const [open, setOpen] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const statusMap = new Map(
    status.data?.items.map((i) => [i.provider.id, i]) ?? [],
  );

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            节点源 (Providers)
          </h1>
          <p className="text-muted-foreground mt-1">
            订阅 URL / 内嵌节点文本; 多源去重合并
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => refreshAll.mutate()}
            disabled={refreshAll.isPending}
          >
            <RefreshCw
              className={
                refreshAll.isPending ? "h-4 w-4 animate-spin" : "h-4 w-4"
              }
            />
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
          const expanded = expandedIds.has(p.id);
          // 只要后端有 cache(无论 ok/stale/error/0 节点)都允许展开,展开后 panel 内会展示
          // 节点列表 / 错误原因 / 占位文案——这是查"为什么是 0 个节点"的唯一入口。
          const canExpand = !!s?.cached;
          const isInline = p.type === "inline";
          const zeroNodes = s?.cached && (s.node_count ?? 0) === 0;
          return (
            <Card
              key={p.id}
              className={cn(
                "p-4 transition-colors",
                canExpand && "cursor-pointer hover:bg-muted/30",
                !p.enabled && "opacity-60 bg-muted/20 hover:opacity-100",
              )}
              onClick={canExpand ? () => toggleExpand(p.id) : undefined}
            >
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <span
                    className={cn(
                      "font-medium",
                      !p.enabled && "line-through decoration-1",
                    )}
                  >
                    {p.name}
                  </span>
                  {(p.url ?? p.path) && (
                    <div
                      className="text-xs text-muted-foreground mt-1 truncate"
                      title={p.url ?? p.path}
                    >
                      {p.url ? (
                        (() => {
                          const { text, queryCount } = formatUrlDisplay(p.url);
                          return (
                            <>
                              {text}
                              {queryCount > 0 && (
                                <span className="ml-1 text-muted-foreground/60">
                                  · {queryCount} 个参数
                                </span>
                              )}
                            </>
                          );
                        })()
                      ) : (
                        p.path
                      )}
                    </div>
                  )}
                  {s?.fetched_at && !isInline && (
                    <div className="text-xs text-muted-foreground mt-1">
                      上次刷新 <RefreshedAt ts={s.fetched_at} /> · 刷新周期{" "}
                      {REFRESH_INTERVAL_LABEL[p.refresh.interval] ?? p.refresh.interval}
                    </div>
                  )}
                  {isInline && (
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      最新
                    </div>
                  )}
                  {s?.error && (
                    <div className="text-xs text-destructive mt-1">
                      错误: {s.error}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="flex items-center gap-1.5 flex-wrap justify-end">
                    <Badge variant="outline" className="text-xs">
                      {p.type}
                    </Badge>
                    {!p.enabled && (
                      <Badge
                        variant="disabled"
                        className="text-xs flex items-center gap-1"
                      >
                        <Ban className="h-3 w-3" /> 已禁用
                      </Badge>
                    )}
                    {s?.status === "ok" && s.node_count > 0 && (
                      <Badge
                        variant="success"
                        className="text-xs flex items-center gap-1"
                      >
                        <CheckCircle2 className="h-3 w-3" /> {s.node_count} 个节点
                      </Badge>
                    )}
                    {s?.status === "ok" && s.node_count === 0 && (
                      <Badge
                        variant="warning"
                        className="text-xs flex items-center gap-1"
                        title="解析未识别到任何节点,展开查看详情"
                      >
                        <AlertCircle className="h-3 w-3" /> 0 个节点
                      </Badge>
                    )}
                    {s?.status === "stale" && (
                      <Badge
                        variant="warning"
                        className="text-xs flex items-center gap-1"
                      >
                        <Clock className="h-3 w-3" /> 使用旧缓存
                      </Badge>
                    )}
                    {s?.status === "error" && (
                      <Badge
                        variant="destructive"
                        className="text-xs flex items-center gap-1"
                      >
                        <AlertCircle className="h-3 w-3" /> 失败
                      </Badge>
                    )}
                    {p.enabled && s && !s.cached && !isInline && (
                      <Badge
                        variant="outline"
                        className="text-xs flex items-center gap-1 border-amber-500 text-amber-600 dark:text-amber-400"
                        title="后端正在首次拉取节点,稍候自动刷新"
                      >
                        <Loader2 className="h-3 w-3 animate-spin" /> 拉取中...
                      </Badge>
                    )}
                  </div>
                  <div
                    className="flex items-center gap-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {canExpand && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleExpand(p.id)}
                        title={expanded ? "收起节点列表" : "展开节点列表"}
                      >
                        <ChevronDown
                          className={`h-4 w-4 transition-transform duration-200 ${
                            expanded ? "rotate-180" : ""
                          }`}
                        />
                      </Button>
                    )}
                    {/* inline 没有"上游"可拉,不显示刷新按钮;后端在 PUT 路径会自动重解析,
                        保存即生效。这里渲染等宽透明占位,使 Edit/Trash2 与 http/file 卡片对齐。 */}
                    {!isInline ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => refreshOne.mutate(p.id)}
                        disabled={
                          refreshOne.isPending ||
                          (p.refresh.interval === "never" &&
                            s?.status === "ok" &&
                            s.node_count > 0)
                        }
                        title={
                          p.refresh.interval === "never"
                            ? "永久缓存模式,需在编辑器中改为其他选项后才能刷新"
                            : "刷新此源"
                        }
                      >
                        <RefreshCw
                          className={
                            refreshOne.isPending && refreshOne.variables === p.id
                              ? "h-4 w-4 animate-spin"
                              : "h-4 w-4"
                          }
                        />
                      </Button>
                    ) : (
                      <div className="h-9 w-9 shrink-0" aria-hidden />
                    )}
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
              </div>
              {canExpand && (
                <div
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${
                    expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                  }`}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="overflow-hidden">
                    <ProviderNodesPanel
                      providerId={p.id}
                      enabled={expanded}
                      statusError={s?.error}
                      isInline={isInline}
                      zeroNodes={!!zeroNodes}
                      onEdit={() => {
                        setEditing(p);
                        setOpen(true);
                      }}
                    />
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <EntityVisualDialog<ProviderData>
        kind="providers"
        entity={editing}
        open={open}
        onOpenChange={setOpen}
        defaultId={editing?.id ?? `provider-${Date.now().toString(36)}`}
        templateValue={DEFAULT_PROVIDER_TEMPLATE}
        description="可视化编辑节点源;复杂场景可切换 YAML 模式"
        renderForm={(data, update) => (
          <ProviderVisualForm
            data={data}
            update={update}
            isNew={!editing}
          />
        )}
      />
    </div>
  );
}

function ProviderNodesPanel({
  providerId,
  enabled,
  statusError,
  isInline,
  zeroNodes,
  onEdit,
}: {
  providerId: string;
  enabled: boolean;
  statusError?: string;
  isInline: boolean;
  zeroNodes: boolean;
  onEdit: () => void;
}) {
  const [search, setSearch] = useState("");
  // 0 节点时不调 nodes API(后端会返回 200 + 空数组,信息量不如 status.error 充足)。
  const shouldFetch = enabled && !zeroNodes;
  const query = useQuery<ProviderNodesResp>({
    queryKey: ["providers", providerId, "nodes"],
    queryFn: () => api.get(`/api/providers/${providerId}/nodes`),
    staleTime: 30_000,
    enabled: shouldFetch,
  });

  const filtered = useMemo(() => {
    const nodes = query.data?.nodes ?? [];
    const f = search.trim().toLowerCase();
    if (!f) return nodes;
    return nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(f) ||
        n.server.toLowerCase().includes(f),
    );
  }, [query.data?.nodes, search]);

  if (zeroNodes) {
    return (
      <div className="mt-3 pt-3 border-t">
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-3 text-xs space-y-2">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-200 font-medium">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>未识别到任何节点</span>
          </div>
          <div className="text-muted-foreground leading-relaxed">
            {statusError ? (
              <>具体原因: <span className="font-mono">{statusError}</span></>
            ) : (
              "原因不明。常见情况:content 为空、格式不被识别、parser_hint 错配。"
            )}
          </div>
          <ul className="text-muted-foreground list-disc pl-4 space-y-0.5">
            {isInline ? (
              <>
                <li>
                  Clash YAML: 含{" "}
                  <code className="font-mono">proxies:</code> 数组,每项须有{" "}
                  <code className="font-mono">name</code> /{" "}
                  <code className="font-mono">type</code> /{" "}
                  <code className="font-mono">server</code> /{" "}
                  <code className="font-mono">port</code>
                </li>
                <li>
                  Surge: 完整 .conf (含{" "}
                  <code className="font-mono">[Proxy]</code> 段) 或裸代理行 (如{" "}
                  <code className="font-mono">
                    name = trojan, host, port, ...
                  </code>
                  )
                </li>
                <li>
                  URI: 一行一个{" "}
                  <code className="font-mono">
                    ss:// vmess:// vless:// trojan:// hysteria2:// tuic://
                    socks5://
                  </code>{" "}
                  等
                </li>
                <li>
                  v2ray base64: base64 编码的 URI 列表,auto 可自动解码
                </li>
                <li>
                  混贴 URI + Surge 行: parser_hint 改为{" "}
                  <code className="font-mono">mixed</code>
                </li>
                <li>
                  <code className="font-mono">direct</code>{" "}
                  类型节点会被自动跳过不计入
                </li>
              </>
            ) : (
              <>
                <li>确认 URL 返回的是节点文本,而非 HTML 页面或空响应</li>
                <li>
                  部分机场按 User-Agent 返回不同格式,可尝试修改 UA (如{" "}
                  <code className="font-mono">clash</code> /{" "}
                  <code className="font-mono">Surge/2400</code> /{" "}
                  <code className="font-mono">v2rayN</code>)
                </li>
                <li>
                  如 auto 识别有误,可手动指定 parser_hint
                </li>
              </>
            )}
          </ul>
          <div className="flex gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={onEdit}
            >
              <Edit className="h-3.5 w-3.5" /> 编辑 content / parser_hint
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (query.isLoading) {
    return (
      <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
        加载节点中...
      </div>
    );
  }

  if (query.error) {
    const msg = (query.error as Error).message ?? "";
    return (
      <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
        {msg.includes("no cache")
          ? "尚未刷新, 请先点击右上角的刷新按钮"
          : `加载失败: ${msg}`}
      </div>
    );
  }

  const total = query.data?.count ?? 0;
  if (total === 0) {
    return (
      <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
        无节点
      </div>
    );
  }

  return (
    <div className="mt-3 pt-3 border-t space-y-2">
      <div className="flex items-center gap-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Input
          placeholder={`搜索 ${total} 个节点 (按 name 或 server)`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 text-xs max-w-md"
        />
        <span className="text-xs text-muted-foreground ml-auto shrink-0">
          {filtered.length} / {total}
        </span>
      </div>
      <div className="rounded border divide-y max-h-96 overflow-auto">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            无匹配节点
          </div>
        ) : (
          filtered.map((n, i) => <NodeRow key={`${n.name}-${i}`} n={n} />)
        )}
      </div>
    </div>
  );
}
