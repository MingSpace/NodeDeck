import { useEffect, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import yaml from "js-yaml";
import { ArrowLeft, Save, RefreshCw, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { YamlEditor } from "@/components/yaml-editor";
import { useEntity, useSaveEntity } from "@/api/entities";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

interface Profile {
  id: string;
  name: string;
  description?: string;
  token: string;
  providers: string[];
  proxy_groups: string[];
  rule_modules: unknown[];
  chain_rules: unknown[];
  surge_modules: string[];
}

interface PreviewResponse {
  target: "clash" | "surge";
  text: string;
  warnings: string[];
  node_count: number;
}

export function ProfileEditorPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const profileQuery = useEntity<Profile>("profiles", id);
  const save = useSaveEntity<Profile>("profiles");
  const [yamlText, setYamlText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [previewTarget, setPreviewTarget] = useState<"clash" | "surge">("clash");

  useEffect(() => {
    if (profileQuery.data) {
      setYamlText(yaml.dump(profileQuery.data, { sortKeys: false, lineWidth: 200 }));
      setDirty(false);
    }
  }, [profileQuery.data]);

  const preview = useQuery<PreviewResponse>({
    queryKey: ["preview", id, previewTarget],
    queryFn: () => api.get(`/api/profiles/${id}/preview?target=${previewTarget}`),
    enabled: !!id && !!profileQuery.data,
  });

  const onSave = async () => {
    try {
      const parsed = yaml.load(yamlText) as Profile;
      if (!parsed.id) parsed.id = id;
      await save.mutateAsync(parsed);
      toast({ title: "已保存", variant: "success" });
      setDirty(false);
      queryClient.invalidateQueries({ queryKey: ["preview", id] });
    } catch (err) {
      toast({ title: "保存失败", description: (err as Error).message, variant: "error" });
    }
  };

  const onRegenerateToken = async () => {
    if (!window.confirm("重新生成 token 后,旧的订阅 URL 会失效。继续?")) return;
    try {
      await api.post(`/api/profiles/${id}/regenerate-token`);
      toast({ title: "Token 已更新", variant: "success" });
      profileQuery.refetch();
    } catch (err) {
      toast({ title: "失败", description: String(err), variant: "error" });
    }
  };

  if (profileQuery.isLoading) return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (profileQuery.error || !profileQuery.data)
    return (
      <div className="p-8">
        <Button asChild variant="outline">
          <Link to="/profiles">
            <ArrowLeft className="h-4 w-4" /> 返回
          </Link>
        </Button>
        <div className="mt-4 text-destructive">Profile 加载失败</div>
      </div>
    );

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b bg-card px-6 py-3 flex items-center gap-4 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/profiles")}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{profileQuery.data.name}</span>
            <Badge variant="outline" className="text-xs font-mono">{profileQuery.data.id}</Badge>
            {dirty && <Badge variant="warning" className="text-xs">未保存</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            token=<code>{profileQuery.data.token}</code>
            <button onClick={onRegenerateToken} className="ml-2 text-primary hover:underline">
              重新生成
            </button>
          </div>
        </div>
        <Button onClick={onSave} disabled={!dirty || save.isPending}>
          <Save className="h-4 w-4" />
          {save.isPending ? "保存中..." : "保存"}
        </Button>
      </header>

      <div className="flex-1 grid grid-cols-2 min-h-0">
        <div className="border-r flex flex-col min-h-0">
          <div className="px-4 py-2 text-xs font-medium text-muted-foreground border-b bg-muted/30">
            Profile YAML
          </div>
          <div className="flex-1 min-h-0">
            <YamlEditor
              value={yamlText}
              onChange={(v) => {
                setYamlText(v);
                setDirty(true);
              }}
              height="100%"
            />
          </div>
        </div>

        <div className="flex flex-col min-h-0">
          <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-3 shrink-0">
            <Eye className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">实时预览</span>
            <Tabs value={previewTarget} onValueChange={(v) => setPreviewTarget(v as "clash" | "surge")}>
              <TabsList className="h-7">
                <TabsTrigger value="clash" className="text-xs px-2 py-0.5">Clash YAML</TabsTrigger>
                <TabsTrigger value="surge" className="text-xs px-2 py-0.5">Surge .conf</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => preview.refetch()}>
              <RefreshCw className={preview.isFetching ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            </Button>
            {preview.data && (
              <Badge variant="outline" className="text-xs">
                {preview.data.node_count} 个节点
              </Badge>
            )}
          </div>
          {preview.data?.warnings && preview.data.warnings.length > 0 && (
            <Card className="m-2 p-2 text-xs bg-amber-50 border-amber-200 text-amber-900 shrink-0 max-h-32 overflow-auto">
              <div className="font-medium mb-1">{preview.data.warnings.length} 条警告:</div>
              <ul className="list-disc list-inside space-y-0.5">
                {preview.data.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Card>
          )}
          <div className="flex-1 min-h-0 overflow-hidden">
            {preview.isLoading && <div className="p-4 text-sm text-muted-foreground">生成中...</div>}
            {preview.error && (
              <div className="p-4 text-sm text-destructive">预览失败: {String(preview.error)}</div>
            )}
            {preview.data && (
              <YamlEditor
                value={preview.data.text}
                onChange={() => {}}
                language={previewTarget === "clash" ? "yaml" : "ini"}
                readOnly
                height="100%"
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
