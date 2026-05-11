import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Edit, Plus, Save, Search, Trash2, FileCode } from "lucide-react";
import yaml from "js-yaml";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { YamlEditor } from "@/components/yaml-editor";
import { ManualNodeDialog } from "@/components/manual-node-dialog";
import { NodeDetail } from "@/components/node-detail";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

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

interface ManualNodes {
  nodes: NodeBrief[];
}

interface AirportItem {
  id: string;
  name: string;
}

const MANUAL_SOURCE_ID = "manual";

function useAirports() {
  return useQuery<{ items: AirportItem[] }>({
    queryKey: ["dashboard", "airports"],
    queryFn: () => api.get("/api/dashboard/airports"),
  });
}

function useProviderName() {
  const dashboard = useAirports();
  return (id: string | undefined) => {
    if (!id || id === MANUAL_SOURCE_ID) return MANUAL_SOURCE_ID;
    return dashboard.data?.items.find((p) => p.id === id)?.name ?? id;
  };
}

interface DialogState {
  open: boolean;
  mode: "create" | "edit";
  originalName?: string;
}

export function NodesPage() {
  const [tab, setTab] = useState<"all" | "manual" | "by-provider">("all");
  const [dialog, setDialog] = useState<DialogState>({ open: false, mode: "create" });

  const openCreate = () => setDialog({ open: true, mode: "create" });
  const openEdit = (name: string) => setDialog({ open: true, mode: "edit", originalName: name });

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-4">
        <h1 className="text-2xl font-bold tracking-tight">节点池 (Node Pool)</h1>
        <p className="text-muted-foreground mt-1">来自所有启用 Provider 与手动节点的统一池(已去重)</p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="all">全部节点</TabsTrigger>
          <TabsTrigger value="manual">手动节点</TabsTrigger>
          <TabsTrigger value="by-provider">按 Provider 分组</TabsTrigger>
        </TabsList>
        <TabsContent value="all">
          <AllNodesView onEdit={openEdit} />
        </TabsContent>
        <TabsContent value="manual">
          <ManualNodesView onCreate={openCreate} onEdit={openEdit} />
        </TabsContent>
        <TabsContent value="by-provider">
          <ByProviderView onEdit={openEdit} />
        </TabsContent>
      </Tabs>

      <ManualNodeDialog
        open={dialog.open}
        onOpenChange={(v) => setDialog((s) => ({ ...s, open: v }))}
        mode={dialog.mode}
        originalName={dialog.originalName}
      />
    </div>
  );
}

function AllNodesView({ onEdit }: { onEdit: (name: string) => void }) {
  const pool = useQuery<NodePoolResp>({
    queryKey: ["dashboard", "node-pool"],
    queryFn: () => api.get("/api/dashboard/node-pool"),
  });
  const providerName = useProviderName();
  const [search, setSearch] = useState("");
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
      const src = n.source_provider_id ?? MANUAL_SOURCE_ID;
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
        const src = n.source_provider_id ?? MANUAL_SOURCE_ID;
        if (src !== filterSource) return false;
      }
      if (f && !n.name.toLowerCase().includes(f) && !n.server.toLowerCase().includes(f)) return false;
      return true;
    });
  }, [allNodes, search, filterRegion, filterType, filterLevel, filterLine, filterSource]);

  if (pool.isLoading) return <div className="p-8 text-sm text-muted-foreground">加载中...</div>;
  if (pool.error)
    return <div className="p-8 text-sm text-destructive">加载失败: {String(pool.error)}</div>;

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center gap-2">
        <Search className="h-4 w-4 text-muted-foreground shrink-0" />
        <Input
          placeholder={`搜索 ${pool.data?.count ?? 0} 个节点 (按 name 或 server)`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-md"
        />
        <span className="text-xs text-muted-foreground ml-auto">
          {filtered.length} / {pool.data?.count ?? 0}
        </span>
      </div>

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
              <NodeRow
                key={`${n.name}-${i}`}
                n={n}
                providerName={providerName}
                onEdit={isManual(n) ? () => onEdit(n.name) : undefined}
              />
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
    <div className="flex items-start gap-2 text-xs flex-wrap">
      <span className="text-muted-foreground shrink-0 w-12 mt-1">{label}:</span>
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
  );
}

function isManual(n: NodeBrief): boolean {
  return !n.source_provider_id || n.source_provider_id === MANUAL_SOURCE_ID;
}

function NodeRow({
  n,
  providerName,
  hideSource,
  onEdit,
  onDelete,
}: {
  n: NodeBrief;
  providerName: (id: string | undefined) => string;
  hideSource?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const manual = isManual(n);
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
              manual ? (
                <Badge
                  variant="default"
                  className="shrink-0 bg-purple-600 hover:bg-purple-600 text-[10px] px-1.5 py-0"
                >
                  手动添加
                </Badge>
              ) : (
                <Badge
                  variant="secondary"
                  className="shrink-0 text-[10px] px-1.5 py-0 max-w-[180px] truncate"
                  title={n.source_provider_id}
                >
                  {sourceName}
                </Badge>
              )
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
        <div
          className="flex items-center gap-1 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          {onEdit && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onEdit}
              title="编辑此手动节点"
            >
              <Edit className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onDelete}
              title="删除此手动节点"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${
              expanded ? "rotate-180" : ""
            }`}
          />
        </div>
      </div>
      {expanded && (
        <div
          className="border-t bg-muted/20 p-3"
          onClick={(e) => e.stopPropagation()}
        >
          <NodeDetail node={n} />
        </div>
      )}
    </div>
  );
}

function ManualNodesView({
  onCreate,
  onEdit,
}: {
  onCreate: () => void;
  onEdit: (name: string) => void;
}) {
  const queryClient = useQueryClient();
  const providerName = useProviderName();
  const [yamlEditing, setYamlEditing] = useState(false);
  const [yamlText, setYamlText] = useState("");

  const manual = useQuery<ManualNodes>({
    queryKey: ["entities", "manual-nodes"],
    queryFn: () => api.get("/api/entities/manual-nodes"),
  });

  const saveManual = useMutation({
    mutationFn: (data: ManualNodes) => api.put("/api/entities/manual-nodes", data),
    onSuccess: () => {
      toast({ title: "已保存", variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["entities", "manual-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "node-pool"] });
      setYamlEditing(false);
    },
    onError: (err) => {
      toast({ title: "保存失败", description: String(err), variant: "error" });
    },
  });

  const handleEnterYamlEdit = () => {
    setYamlText(yaml.dump(manual.data ?? { nodes: [] }, { sortKeys: false }));
    setYamlEditing(true);
  };

  const handleYamlSave = () => {
    try {
      const data = yaml.load(yamlText) as ManualNodes;
      saveManual.mutate(data);
    } catch (err) {
      toast({ title: "YAML 错误", description: (err as Error).message, variant: "error" });
    }
  };

  const handleDelete = (name: string) => {
    const all = manual.data?.nodes ?? [];
    if (!confirm(`确定要删除节点「${name}」吗?`)) return;
    saveManual.mutate({ nodes: all.filter((n) => n.name !== name) });
  };

  const list = manual.data?.nodes ?? [];

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">手动节点 ({list.length})</span>
        {!yamlEditing ? (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleEnterYamlEdit}>
              <FileCode className="h-4 w-4" />
              高级 YAML 编辑
            </Button>
            <Button size="sm" onClick={onCreate}>
              <Plus className="h-4 w-4" />
              添加节点
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setYamlEditing(false)}>
              取消
            </Button>
            <Button size="sm" onClick={handleYamlSave} disabled={saveManual.isPending}>
              <Save className="h-4 w-4" />
              保存
            </Button>
          </div>
        )}
      </div>
      {yamlEditing ? (
        <YamlEditor value={yamlText} onChange={setYamlText} height={500} />
      ) : (
        <Card className="overflow-hidden">
          {list.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">
              暂无手动节点。点击右上角「添加节点」创建一个。
            </div>
          ) : (
            <div className="divide-y">
              {list.map((n, i) => (
                <NodeRow
                  key={`${n.name}-${i}`}
                  n={n}
                  providerName={providerName}
                  hideSource
                  onEdit={() => onEdit(n.name)}
                  onDelete={() => handleDelete(n.name)}
                />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ByProviderView({ onEdit }: { onEdit: (name: string) => void }) {
  const pool = useQuery<NodePoolResp>({
    queryKey: ["dashboard", "node-pool"],
    queryFn: () => api.get("/api/dashboard/node-pool"),
  });
  const providerName = useProviderName();

  if (pool.isLoading) return <div className="mt-3 text-sm text-muted-foreground">加载中...</div>;
  if (!pool.data) return null;

  const groupTitle = (id: string) => (id === MANUAL_SOURCE_ID ? "手动节点" : providerName(id));

  const entries = Object.entries(pool.data.by_provider).sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="space-y-4 mt-3">
      {entries.length === 0 && (
        <div className="text-sm text-muted-foreground text-center p-8">暂无节点</div>
      )}
      {entries.map(([id, nodes]) => {
        const isManualGroup = id === MANUAL_SOURCE_ID;
        return (
          <Card key={id} className="overflow-hidden">
            <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
              <span className="text-sm font-medium">{groupTitle(id)}</span>
              <Badge variant="secondary" className="text-xs">
                {nodes.length} 个节点
              </Badge>
            </div>
            <div className="divide-y max-h-96 overflow-auto">
              {nodes.map((n, i) => (
                <NodeRow
                  key={`${n.name}-${i}`}
                  n={n}
                  providerName={providerName}
                  hideSource
                  onEdit={isManualGroup ? () => onEdit(n.name) : undefined}
                />
              ))}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
