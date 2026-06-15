import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Plus, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { NodeDetail } from "@/components/node-detail";
import { api } from "@/lib/api";

// @business_rule: 后端 /api/dashboard/node-pool 已透传完整 Node;
// 这里只列出列表展示用到的核心字段,其它字段(password / uuid / ws_opts 等)用
// [key: string]: unknown 透传到 NodeDetail YAML 块。
interface NodeBrief {
  name: string;
  type: string;
  server: string;
  port: number;
  source_provider_id?: string;
  region?: string;
  level?: string;
  line?: string;
  tags?: string[];
  udp?: boolean;
  tfo?: boolean;
  [key: string]: unknown;
}

interface NodePoolResp {
  nodes: NodeBrief[];
  count: number;
  by_provider: Record<string, NodeBrief[]>;
}

interface AirportItem {
  id: string;
  name: string;
  /** Provider type: http / file / inline */
  type: "http" | "file" | "inline";
}

// @business_rule: 节点池 Tab 分类规则:
// - 全部: 所有 Provider 的节点扁平展示 + 多维 facet 筛选
// - 远程: 来自 type=http 的 Provider(订阅 URL)
// - 本地: 来自 type=inline / file 的 Provider(用户粘贴 / 服务器本地文件)
type LocalKind = "http" | "file" | "inline";
const REMOTE_TYPES: ReadonlyArray<LocalKind> = ["http"];
const LOCAL_TYPES: ReadonlyArray<LocalKind> = ["inline", "file"];

function useAirports() {
  return useQuery<{ items: AirportItem[] }>({
    queryKey: ["dashboard", "airports"],
    queryFn: () => api.get("/api/dashboard/airports"),
  });
}

function useProviderName() {
  const dashboard = useAirports();
  return (id: string | undefined) => {
    if (!id) return "(无来源)";
    return dashboard.data?.items.find((p) => p.id === id)?.name ?? id;
  };
}

/** 返回 provider id → type 的映射,用于"远程/本地"分类 */
function useProviderTypeMap(): Map<string, LocalKind> {
  const dashboard = useAirports();
  return useMemo(() => {
    const m = new Map<string, LocalKind>();
    for (const item of dashboard.data?.items ?? []) {
      m.set(item.id, item.type);
    }
    return m;
  }, [dashboard.data]);
}

export function NodesPage() {
  const [tab, setTab] = useState<"all" | "remote" | "local">("all");
  // @user_flow: 搜索框始终常驻于 TabsList 右侧,切换 tab 时不会消失
  // 各 tab view 通过 onCountsChange 把当前 filtered/total 上报到这里展示
  const [search, setSearch] = useState("");
  const [counts, setCounts] = useState<{ filtered: number; total: number }>({
    filtered: 0,
    total: 0,
  });
  const handleCountsChange = useCallback((filtered: number, total: number) => {
    setCounts((prev) =>
      prev.filtered === filtered && prev.total === total ? prev : { filtered, total },
    );
  }, []);

  return (
    <div className="p-8 max-w-[1800px] mx-auto">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">节点池 (Node Pool)</h1>
        <p className="text-muted-foreground mt-1">
          来自所有启用 Provider 的统一池(已去重)。需要手动添加节点请到「节点源」新建一个「静态节点」类型的源。
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <div className="mt-3 flex flex-col gap-3 md:grid md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-x-4 md:gap-y-3">
          <TabsList className="w-fit max-w-full shrink-0 md:col-start-1 md:row-start-1">
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="remote">远程</TabsTrigger>
            <TabsTrigger value="local">本地</TabsTrigger>
          </TabsList>

          <div className="flex min-w-0 w-full items-center gap-2 md:col-start-2 md:row-start-1">
            <div className="hidden min-w-0 shrink md:block md:flex-1" aria-hidden />
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <Input
              placeholder={`搜索 ${counts.total} 个节点 (按 name 或 server)`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-md min-w-0 flex-1 md:w-72 md:max-w-none md:flex-none"
            />
            <span className="shrink-0 text-xs text-muted-foreground">
              {counts.filtered} / {counts.total}
            </span>
          </div>

          <TabsContent
            value="all"
            className="mt-0 md:col-span-2 md:col-start-1 md:row-start-2"
          >
            <AllNodesView search={search} onCountsChange={handleCountsChange} />
          </TabsContent>
          <TabsContent
            value="remote"
            className="mt-0 md:col-span-2 md:col-start-1 md:row-start-2"
          >
            <ByProviderView
              search={search}
              onCountsChange={handleCountsChange}
              filterKinds={REMOTE_TYPES}
              emptyText="暂无远程节点源(订阅 URL)"
              emptyAction={{ to: "/providers?new=http", label: "新建订阅" }}
            />
          </TabsContent>
          <TabsContent
            value="local"
            className="mt-0 md:col-span-2 md:col-start-1 md:row-start-2"
          >
            <ByProviderView
              search={search}
              onCountsChange={handleCountsChange}
              filterKinds={LOCAL_TYPES}
              emptyText="暂无本地节点源。需要手动粘贴节点请新建一个「静态节点」类型的源。"
              emptyAction={{ to: "/providers?new=inline", label: "新建静态节点" }}
            />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

function AllNodesView({
  search,
  onCountsChange,
}: {
  search: string;
  onCountsChange: (filtered: number, total: number) => void;
}) {
  const pool = useQuery<NodePoolResp>({
    queryKey: ["dashboard", "node-pool"],
    queryFn: () => api.get("/api/dashboard/node-pool"),
  });
  const providerName = useProviderName();
  const [filterRegion, setFilterRegion] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState<string | null>(null);
  const [filterLine, setFilterLine] = useState<string | null>(null);
  const [filterSource, setFilterSource] = useState<string | null>(null);

  const allNodes = pool.data?.nodes ?? [];

  const facets = useMemo(() => {
    const regions = new Map<string, number>();
    const types = new Map<string, number>();
    const levels = new Map<string, number>();
    const lines = new Map<string, number>();
    const sources = new Map<string, number>();
    for (const n of allNodes) {
      types.set(n.type, (types.get(n.type) ?? 0) + 1);
      if (n.region) regions.set(n.region, (regions.get(n.region) ?? 0) + 1);
      if (n.level) levels.set(n.level, (levels.get(n.level) ?? 0) + 1);
      if (n.line) lines.set(n.line, (lines.get(n.line) ?? 0) + 1);
      const src = n.source_provider_id ?? "(unknown)";
      sources.set(src, (sources.get(src) ?? 0) + 1);
    }
    return { regions, types, levels, lines, sources };
  }, [allNodes]);

  const filtered = useMemo(() => {
    const f = search.toLowerCase();
    return allNodes.filter((n) => {
      if (filterRegion && n.region !== filterRegion) return false;
      if (filterType && n.type !== filterType) return false;
      if (filterLevel && n.level !== filterLevel) return false;
      if (filterLine && n.line !== filterLine) return false;
      if (filterSource) {
        const src = n.source_provider_id ?? "(unknown)";
        if (src !== filterSource) return false;
      }
      if (f && !n.name.toLowerCase().includes(f) && !n.server.toLowerCase().includes(f)) return false;
      return true;
    });
  }, [allNodes, search, filterRegion, filterType, filterLevel, filterLine, filterSource]);

  // @user_flow: 把 facet+search 过滤后的数量 / 全量数量上报给父组件,展示在顶部搜索框右侧
  useEffect(() => {
    onCountsChange(filtered.length, allNodes.length);
  }, [filtered.length, allNodes.length, onCountsChange]);

  if (pool.isLoading) return <div className="p-8 text-sm text-muted-foreground">加载中...</div>;
  if (pool.error)
    return <div className="p-8 text-sm text-destructive">加载失败: {String(pool.error)}</div>;

  return (
    <div className="space-y-3">
      <FacetRow
        label="source"
        facets={facets.sources}
        active={filterSource}
        onChange={setFilterSource}
        labelMap={providerName}
      />
      <FacetRow label="region" facets={facets.regions} active={filterRegion} onChange={setFilterRegion} />
      <FacetRow label="type" facets={facets.types} active={filterType} onChange={setFilterType} />
      {facets.levels.size > 0 && (
        <FacetRow label="level" facets={facets.levels} active={filterLevel} onChange={setFilterLevel} />
      )}
      {facets.lines.size > 0 && (
        <FacetRow label="line" facets={facets.lines} active={filterLine} onChange={setFilterLine} />
      )}

      <Card className="overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">无匹配节点</div>
        ) : (
          <div className="divide-y max-h-[60vh] overflow-auto">
            {filtered.map((n, i) => (
              <NodeRow key={`${n.name}-${i}`} n={n} providerName={providerName} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function FacetRow({
  label,
  facets,
  active,
  onChange,
  labelMap,
}: {
  label: string;
  facets: Map<string, number>;
  active: string | null;
  onChange: (v: string | null) => void;
  labelMap?: (k: string) => string;
}) {
  const items = Array.from(facets.entries()).sort((a, b) => b[1] - a[1]);
  if (items.length === 0) return null;
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-muted-foreground shrink-0 w-12 text-right mt-1">{label}:</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(null)}
          className={
            active === null
              ? "px-2 py-0.5 rounded text-xs font-medium border bg-primary text-primary-foreground border-primary"
              : "px-2 py-0.5 rounded text-xs font-medium border bg-background text-foreground hover:bg-accent border-input"
          }
        >
          全部
        </button>
        {items.map(([k, v]) => (
          <button
            key={k}
            type="button"
            onClick={() => onChange(active === k ? null : k)}
            className={
              active === k
                ? "px-2 py-0.5 rounded text-xs font-medium border bg-primary text-primary-foreground border-primary"
                : "px-2 py-0.5 rounded text-xs font-medium border bg-background text-foreground hover:bg-accent border-input"
            }
          >
            {labelMap ? labelMap(k) : k} <span className="opacity-70">{v}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function NodeRow({
  n,
  providerName,
  hideSource,
}: {
  n: NodeBrief;
  providerName: (id: string | undefined) => string;
  hideSource?: boolean;
}) {
  const sourceName = providerName(n.source_provider_id);
  const tags = n.tags ?? [];
  const showThirdRow = tags.length > 0 || n.udp || n.tfo;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="select-none">
      <div
        className="flex items-start gap-3 p-3 cursor-pointer hover:bg-muted/30"
        onClick={() => setExpanded((v) => !v)}
      >
        <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0 shrink-0 mt-0.5">
          {n.type}
        </Badge>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2">
            <div className="font-medium text-sm truncate flex-1 min-w-0">{n.name}</div>
            {!hideSource && (
              <Badge
                variant="secondary"
                className="shrink-0 text-[10px] px-1.5 py-0 max-w-[180px] truncate"
                title={n.source_provider_id}
              >
                {sourceName}
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground truncate">
            {n.server}:{n.port}
            {n.region && ` · ${n.region}`}
            {n.level && ` · ${n.level}`}
            {n.line && ` · ${n.line}`}
          </div>
          {showThirdRow && (
            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
              {n.udp && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                  udp
                </Badge>
              )}
              {n.tfo && (
                <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                  tfo
                </Badge>
              )}
              {tags.map((t) => (
                <Badge
                  key={t}
                  variant="outline"
                  className="text-[10px] px-1.5 py-0 font-normal text-muted-foreground"
                >
                  #{t}
                </Badge>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>
      {expanded && (
        <div className="border-t bg-muted/20 p-3" onClick={(e) => e.stopPropagation()}>
          <NodeDetail node={n} />
        </div>
      )}
    </div>
  );
}

function ByProviderView({
  filterKinds,
  emptyText,
  emptyAction,
  search,
  onCountsChange,
}: {
  filterKinds: ReadonlyArray<LocalKind>;
  emptyText: string;
  emptyAction?: { to: string; label: string };
  search: string;
  onCountsChange: (filtered: number, total: number) => void;
}) {
  const pool = useQuery<NodePoolResp>({
    queryKey: ["dashboard", "node-pool"],
    queryFn: () => api.get("/api/dashboard/node-pool"),
  });
  const providerName = useProviderName();
  const typeMap = useProviderTypeMap();

  // 仅保留 filterKinds 中类型的 provider,作为该 tab 的全集
  const scopedEntries = useMemo(() => {
    if (!pool.data) return [] as Array<[string, NodeBrief[]]>;
    return Object.entries(pool.data.by_provider)
      .filter(([id]) => {
        const t = typeMap.get(id);
        return t !== undefined && filterKinds.includes(t);
      })
      .sort((a, b) => b[1].length - a[1].length);
  }, [pool.data, typeMap, filterKinds]);

  // @user_flow: 搜索作用于每个 provider 卡片内部;有匹配的卡片显示,空匹配的卡片在搜索激活时隐藏
  // displayEntries: [providerId, matchedNodes, totalNodes] — 卡片头部需要同时显示 matched/total
  const { displayEntries, totalCount, filteredCount } = useMemo(() => {
    const f = search.trim().toLowerCase();
    let total = 0;
    let filtered = 0;
    const out: Array<[string, NodeBrief[], number]> = [];
    for (const [id, nodes] of scopedEntries) {
      total += nodes.length;
      const matched = f
        ? nodes.filter(
            (n) => n.name.toLowerCase().includes(f) || n.server.toLowerCase().includes(f),
          )
        : nodes;
      filtered += matched.length;
      if (matched.length > 0 || !f) out.push([id, matched, nodes.length]);
    }
    return { displayEntries: out, totalCount: total, filteredCount: filtered };
  }, [scopedEntries, search]);

  useEffect(() => {
    onCountsChange(filteredCount, totalCount);
  }, [filteredCount, totalCount, onCountsChange]);

  if (pool.isLoading) return <div className="mt-3 text-sm text-muted-foreground">加载中...</div>;
  if (!pool.data) return null;

  const hasAnyProvider = scopedEntries.length > 0;
  const hasSearch = search.trim().length > 0;

  return (
    <div className="space-y-4 mt-3">
      {!hasAnyProvider && (
        // @user_flow: 空态除提示文本外提供 CTA 按钮直接跳到节点源新建对话框,
        // 远程跳 ?new=http,本地跳 ?new=inline,落地页自动弹窗 + 预选类型。
        <div className="flex flex-col items-center gap-3 p-8 rounded-md border border-dashed">
          <div className="text-sm text-muted-foreground text-center">{emptyText}</div>
          {emptyAction && (
            <Button asChild size="sm" variant="outline">
              <Link to={emptyAction.to}>
                <Plus className="h-4 w-4" />
                {emptyAction.label}
              </Link>
            </Button>
          )}
        </div>
      )}
      {hasAnyProvider && hasSearch && displayEntries.length === 0 && (
        <div className="p-8 text-center text-muted-foreground text-sm rounded-md border border-dashed">
          无匹配节点
        </div>
      )}
      {displayEntries.map(([id, nodes, providerTotal]) => (
        <Card key={id} className="overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
            <span className="text-sm font-medium">{providerName(id)}</span>
            <Badge variant="secondary" className="text-xs">
              {hasSearch && nodes.length !== providerTotal
                ? `${nodes.length} / ${providerTotal} 个节点`
                : `${providerTotal} 个节点`}
            </Badge>
          </div>
          <div className="divide-y max-h-96 overflow-auto">
            {nodes.map((n, i) => (
              <NodeRow key={`${n.name}-${i}`} n={n} providerName={providerName} hideSource />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
