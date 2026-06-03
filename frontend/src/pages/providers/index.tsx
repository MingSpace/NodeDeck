import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { NodeRow, type NodeBrief } from "@/components/node-row";
import { RefreshedAt } from "@/components/refreshed-at";
import { useEntityList, useDeleteEntity, useDeleteEntitiesBulk } from "@/api/entities";
import { EntityVisualDialog } from "@/components/entity-visual-dialog";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";
import {
  ProviderVisualForm,
  DEFAULT_PROVIDER_TEMPLATE,
  INLINE_PROVIDER_TEMPLATE,
  type ProviderData,
  type ProviderType,
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
  never: "手动刷新",
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
  const bulkDel = useDeleteEntitiesBulk("providers");
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
      toast({
        title: "已触发刷新",
        description: `刷新 ${data?.count ?? 0} 个`,
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
      toast({ title: "刷新失败", description: err.message ?? "", variant: "error" });
    },
  });

  const [editing, setEditing] = useState<ProviderData | null>(null);
  const [open, setOpen] = useState(false);
  // @user_flow: 节点池空态 / dashboard 等位置带 ?new=inline|http 跳进来时,
  // 直接打开新建对话框 + 把模板的 type 切到对应类型,省去用户再点「新建」+ 切 tab。
  // 关闭对话框后 reset,这样手动点「新建」永远是默认 http 模板。
  const [pendingNewType, setPendingNewType] = useState<ProviderType | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // dashboard 错误卡片点击会带 ?focus=<provider_id> 进来,自动展开 + 滚动定位 + 短暂高亮
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const focusId = searchParams.get("focus");
  const newType = searchParams.get("new");
  const lastHandledFocus = useRef<string | null>(null);
  const lastHandledNew = useRef<string | null>(null);

  const statusMap = new Map(
    status.data?.items.map((i) => [i.provider.id, i]) ?? [],
  );

  const items = list.data?.items ?? [];
  // 列表刷新后清掉已被删除的 id,避免幽灵选中导致"已选 X 项"对不上。
  const validSelected = useMemo(() => {
    if (selected.size === 0) return selected;
    const ids = new Set(items.map((p) => p.id));
    const next = new Set<string>();
    selected.forEach((id) => {
      if (ids.has(id)) next.add(id);
    });
    return next;
  }, [items, selected]);
  const allSelected = items.length > 0 && validSelected.size === items.length;
  const partialSelected = validSelected.size > 0 && !allSelected;
  const hasSelection = validSelected.size > 0;

  // 收到 ?focus=<id> 时:展开该卡片 → 滚到视图中 → 高亮 2.5s → 清掉 query param。
  // ref 去重防止 strict mode 双跑;当 focusId 变 null 时复位 ref,允许同一 id 再次跳转。
  useEffect(() => {
    if (!focusId) {
      lastHandledFocus.current = null;
      return;
    }
    if (lastHandledFocus.current === focusId) return;
    if (!items.some((p) => p.id === focusId)) return;
    lastHandledFocus.current = focusId;
    setExpandedIds((prev) => {
      if (prev.has(focusId)) return prev;
      const next = new Set(prev);
      next.add(focusId);
      return next;
    });
    setHighlightId(focusId);
    requestAnimationFrame(() => {
      document
        .getElementById(`provider-card-${focusId}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const next = new URLSearchParams(searchParams);
    next.delete("focus");
    setSearchParams(next, { replace: true });
    const t = setTimeout(() => setHighlightId(null), 2500);
    return () => clearTimeout(t);
  }, [focusId, items, searchParams, setSearchParams]);

  // 收到 ?new=inline|http 时:打开新建对话框并把模板预选为对应类型,然后清掉 query param。
  // ref 去重避免 strict mode 双跑 + 同一参数被多次 effect 重复打开。
  useEffect(() => {
    if (!newType) {
      lastHandledNew.current = null;
      return;
    }
    if (lastHandledNew.current === newType) return;
    if (newType !== "inline" && newType !== "http") return;
    lastHandledNew.current = newType;
    setEditing(null);
    setPendingNewType(newType);
    setOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    setSearchParams(next, { replace: true });
  }, [newType, searchParams, setSearchParams]);

  const newTemplate = useMemo<Partial<ProviderData>>(
    () => (pendingNewType === "inline" ? INLINE_PROVIDER_TEMPLATE : DEFAULT_PROVIDER_TEMPLATE),
    [pendingNewType],
  );

  const handleDialogOpenChange = (v: boolean) => {
    setOpen(v);
    if (!v) setPendingNewType(null);
  };

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) setSelected(new Set(items.map((p) => p.id)));
    else setSelected(new Set());
  };

  const clearSelection = () => setSelected(new Set());

  const handleBulkDelete = async () => {
    const ids = Array.from(validSelected);
    if (ids.length === 0) return;
    if (!window.confirm(`确认删除选中的 ${ids.length} 个节点源?此操作不可撤销。`)) return;
    try {
      const res = await bulkDel.mutateAsync(ids);
      if (res.failed.length === 0) {
        toast({ title: `已删除 ${res.succeeded.length} 个节点源`, variant: "success" });
      } else if (res.succeeded.length === 0) {
        toast({
          title: "批量删除失败",
          description: res.failed.slice(0, 3).map((f) => `${f.id}: ${f.error}`).join("; "),
          variant: "error",
        });
      } else {
        toast({
          title: `成功 ${res.succeeded.length} · 失败 ${res.failed.length}`,
          description: res.failed.slice(0, 3).map((f) => `${f.id}: ${f.error}`).join("; "),
          variant: "error",
        });
      }
      clearSelection();
    } catch (err) {
      toast({ title: "批量删除失败", description: String(err), variant: "error" });
    }
  };

  return (
    <div className="p-8 max-w-[1800px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            节点源 (Providers)
          </h1>
          <p className="text-muted-foreground mt-1">
            订阅 URL / 静态节点; 多源去重合并
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

      {list.data && items.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          暂无节点源,点击右上角「新建」添加
        </div>
      )}

      {items.length > 0 && (
        <div
          className={cn(
            "flex items-center gap-3 px-4 py-2.5 mb-3 rounded-md border text-xs transition-colors",
            hasSelection ? "bg-primary/5 border-primary/30" : "bg-muted/30",
          )}
        >
          <Checkbox
            checked={allSelected ? true : partialSelected ? "indeterminate" : false}
            onCheckedChange={(v) => toggleSelectAll(v === true)}
            aria-label="全选"
          />
          {hasSelection ? (
            <>
              <span className="font-medium text-foreground">
                已选 {validSelected.size} / {items.length} 个节点源
              </span>
              <div className="ml-auto flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearSelection}
                  disabled={bulkDel.isPending}
                >
                  <X className="h-3.5 w-3.5" />
                  取消选择
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDelete}
                  disabled={bulkDel.isPending}
                >
                  {bulkDel.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                  批量删除
                </Button>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">共 {items.length} 个,勾选以批量操作</span>
          )}
        </div>
      )}

      <div className="grid gap-3">
        {items.map((p) => {
          const s = statusMap.get(p.id);
          const expanded = expandedIds.has(p.id);
          const checked = validSelected.has(p.id);
          // 只要后端有 cache(无论 ok/stale/error/0 节点)都允许展开,展开后 panel 内会展示
          // 节点列表 / 错误原因 / 占位文案——这是查"为什么是 0 个节点"的唯一入口。
          const canExpand = !!s?.cached;
          const isInline = p.type === "inline";
          const zeroNodes = s?.cached && (s.node_count ?? 0) === 0;
          return (
            <Card
              key={p.id}
              id={`provider-card-${p.id}`}
              className={cn(
                "p-4 transition-all",
                canExpand && "cursor-pointer hover:bg-muted/30",
                !p.enabled && "opacity-60 bg-muted/20 hover:opacity-100",
                checked && "bg-primary/5 hover:bg-primary/10 ring-1 ring-primary/20",
                highlightId === p.id && "ring-2 ring-primary ring-offset-2",
              )}
              onClick={canExpand ? () => toggleExpand(p.id) : undefined}
            >
              <div className="flex items-start justify-between gap-4">
                <div
                  className="pt-0.5 shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => toggleSelectOne(p.id, v === true)}
                    aria-label={`选择 ${p.name}`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <span
                    className={cn(
                      "font-medium inline-flex items-baseline gap-2 min-w-0 flex-wrap",
                      !p.enabled && "line-through decoration-1",
                    )}
                  >
                    <span className="truncate">{p.name}</span>
                    <span className="text-xs font-normal font-mono text-muted-foreground shrink-0">
                      {p.id}
                    </span>
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
                      上次刷新： <RefreshedAt ts={s.fetched_at} /> · 刷新周期{" "}
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
                      {p.type === "inline"
                        ? "静态节点"
                        : p.type === "file"
                          ? "服务器本地路径"
                          : "URL 订阅"}
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
                        disabled={refreshOne.isPending}
                        title={
                          p.refresh.interval === "never"
                            ? "手动刷新模式:点这里立即拉取一次"
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
        onOpenChange={handleDialogOpenChange}
        defaultId={editing?.id ?? `provider-${Date.now().toString(36)}`}
        templateValue={newTemplate}
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
