import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Edit, Save } from "lucide-react";
import yaml from "js-yaml";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { YamlEditor } from "@/components/yaml-editor";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

interface Node {
  name: string;
  type: string;
  server: string;
  port: number;
  source_provider_id?: string;
  region?: string;
  level?: string;
  line?: string;
}

interface ManualNodes {
  nodes: Node[];
}

export function NodesPage() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
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
      setEditing(false);
    },
  });

  const dashboard = useQuery<{ items: { id: string; name: string }[] }>({
    queryKey: ["dashboard", "airports"],
    queryFn: () => api.get("/api/dashboard/airports"),
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

  const allManual = manual.data?.nodes ?? [];
  const filtered = useMemo(() => {
    if (!filter) return allManual;
    const f = filter.toLowerCase();
    return allManual.filter((n) => n.name.toLowerCase().includes(f) || n.server.toLowerCase().includes(f));
  }, [allManual, filter]);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">节点池 (Node Pool)</h1>
          <p className="text-muted-foreground mt-1">手动节点(可编辑) + Provider 来源节点(只读)</p>
        </div>
        {!editing ? (
          <Button onClick={handleEdit}>
            <Edit className="h-4 w-4" />
            编辑手动节点
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditing(false)}>
              取消
            </Button>
            <Button onClick={handleSave} disabled={saveManual.isPending}>
              <Save className="h-4 w-4" />
              保存
            </Button>
          </div>
        )}
      </div>

      {editing ? (
        <YamlEditor value={yamlText} onChange={setYamlText} height={500} />
      ) : (
        <>
          <div className="mb-4">
            <Input
              placeholder="按节点名 / 服务器搜索..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="max-w-sm"
            />
          </div>
          <div className="text-xs text-muted-foreground mb-2">手动节点 ({allManual.length})</div>
          <Card className="overflow-hidden">
            {filtered.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">暂无手动节点</div>
            ) : (
              <div className="divide-y">
                {filtered.map((n, i) => (
                  <div key={`${n.name}-${i}`} className="flex items-center gap-3 p-3 hover:bg-muted/30">
                    <Badge variant="outline" className="text-xs font-mono">
                      {n.type}
                    </Badge>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{n.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {n.server}:{n.port}
                        {n.region && ` · ${n.region}`}
                        {n.level && ` · ${n.level}`}
                        {n.line && ` · ${n.line}`}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="text-xs text-muted-foreground mt-6 mb-2">来自 Provider 的节点(只读)</div>
          <div className="grid gap-2">
            {dashboard.data?.items.map((airport) => (
              <Card key={airport.id} className="p-3 text-sm">
                <span className="font-medium">{airport.name}</span>
                <span className="text-muted-foreground text-xs ml-2">({airport.id})</span>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
