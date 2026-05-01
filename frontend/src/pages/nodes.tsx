import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Edit, Save, Search } from "lucide-react";
import yaml from "js-yaml";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { YamlEditor } from "@/components/yaml-editor";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

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

export function NodesPage() {
  const [tab, setTab] = useState<"all" | "manual" | "by-provider">("all");
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
          <AllNodesView />
        </TabsContent>
        <TabsContent value="manual">
          <ManualNodesView />
        </TabsContent>
        <TabsContent value="by-provider">
          <ByProviderView />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AllNodesView() {
  const pool = useQuery<NodePoolResp>({
    queryKey: ["dashboard", "node-pool"],
    queryFn: () => api.get("/api/dashboard/node-pool"),
  });
  const [search, setSearch] = useState("");
  const [filterRegion, setFilterRegion] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<string | null>(null);
  const [filterLevel, setFilterLevel] = useState<string | null>(null);
  const [filterLine, setFilterLine] = useState<string | null>(null);

  const allNodes = pool.data?.nodes ?? [];

  const facets = useMemo(() => {
    const regions = new Map<string, number>();
    const types = new Map<string, number>();
    const levels = new Map<string, number>();
    const lines = new Map<string, number>();
    for (const n of allNodes) {
      types.set(n.type, (types.get(n.type) ?? 0) + 1);
      if (n.region) regions.set(n.region, (regions.get(n.region) ?? 0) + 1);
      if (n.level) levels.set(n.level, (levels.get(n.level) ?? 0) + 1);
      if (n.line) lines.set(n.line, (lines.get(n.line) ?? 0) + 1);
    }
    return { regions, types, levels, lines };
  }, [allNodes]);

  const filtered = useMemo(() => {
    const f = search.toLowerCase();
    return allNodes.filter((n) => {
      if (filterRegion && n.region !== filterRegion) return false;
      if (filterType && n.type !== filterType) return false;
      if (filterLevel && n.level !== filterLevel) return false;
      if (filterLine && n.line !== filterLine) return false;
      if (f && !n.name.toLowerCase().includes(f) && !n.server.toLowerCase().includes(f)) return false;
      return true;
    });
  }, [allNodes, search, filterRegion, filterType, filterLevel, filterLine]);

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
              <NodeRow key={`${n.name}-${i}`} n={n} />
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
}: {
  label: string;
  facets: Map<string, number>;
  active: string | null;
  onChange: (v: string | null) => void;
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
          {k} <span className="opacity-70">{v}</span>
        </button>
      ))}
    </div>
  );
}

function NodeRow({ n }: { n: NodeBrief }) {
  return (
    <div className="flex items-center gap-3 p-3 hover:bg-muted/30">
      <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
        {n.type}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate">{n.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {n.server}:{n.port}
          {n.region && ` · ${n.region}`}
          {n.level && ` · ${n.level}`}
          {n.line && ` · ${n.line}`}
          {n.source_provider_id && ` · ${n.source_provider_id}`}
        </div>
      </div>
    </div>
  );
}

function ManualNodesView() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
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
      setEditing(false);
    },
  });

  const handleEdit = () => {
    setYamlText(yaml.dump(manual.data ?? { nodes: [] }, { sortKeys: false }));
    setEditing(true);
  };

  const handleSave = () => {
    try {
      const data = yaml.load(yamlText) as ManualNodes;
      saveManual.mutate(data);
    } catch (err) {
      toast({ title: "YAML 错误", description: (err as Error).message, variant: "error" });
    }
  };

  const list = manual.data?.nodes ?? [];

  return (
    <div className="space-y-3 mt-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">手动节点 ({list.length})</span>
        {!editing ? (
          <Button size="sm" onClick={handleEdit}>
            <Edit className="h-4 w-4" />
            编辑
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(false)}>取消</Button>
            <Button size="sm" onClick={handleSave} disabled={saveManual.isPending}>
              <Save className="h-4 w-4" />
              保存
            </Button>
          </div>
        )}
      </div>
      {editing ? (
        <YamlEditor value={yamlText} onChange={setYamlText} height={500} />
      ) : (
        <Card className="overflow-hidden">
          {list.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground text-sm">暂无手动节点</div>
          ) : (
            <div className="divide-y">
              {list.map((n, i) => (
                <NodeRow key={`${n.name}-${i}`} n={n} />
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ByProviderView() {
  const pool = useQuery<NodePoolResp>({
    queryKey: ["dashboard", "node-pool"],
    queryFn: () => api.get("/api/dashboard/node-pool"),
  });
  const dashboard = useQuery<{ items: AirportItem[] }>({
    queryKey: ["dashboard", "airports"],
    queryFn: () => api.get("/api/dashboard/airports"),
  });

  if (pool.isLoading) return <div className="mt-3 text-sm text-muted-foreground">加载中...</div>;
  if (!pool.data) return null;

  const providerName = (id: string) => {
    if (id === "manual") return "手动节点";
    return dashboard.data?.items.find((p) => p.id === id)?.name ?? id;
  };

  const entries = Object.entries(pool.data.by_provider).sort((a, b) => b[1].length - a[1].length);

  return (
    <div className="space-y-4 mt-3">
      {entries.length === 0 && (
        <div className="text-sm text-muted-foreground text-center p-8">暂无节点</div>
      )}
      {entries.map(([id, nodes]) => (
        <Card key={id} className="overflow-hidden">
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center justify-between">
            <span className="text-sm font-medium">{providerName(id)}</span>
            <Badge variant="secondary" className="text-xs">
              {nodes.length} 个节点
            </Badge>
          </div>
          <div className="divide-y max-h-96 overflow-auto">
            {nodes.map((n, i) => (
              <NodeRow key={`${n.name}-${i}`} n={n} />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
