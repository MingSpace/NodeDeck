import { useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProfileForm } from "./use-profile-form";
import { NodeSelector } from "./node-selector";
import { RulePipeline } from "./rule-pipeline";
import { RightPanel } from "./right-panel";
import { PreviewPane } from "./preview-pane";
import { YamlMode } from "./yaml-mode";
import type { Profile } from "./types";

type Mode = "visual" | "yaml";

export function ProfileEditorPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    profileQuery,
    draft,
    dirty,
    update,
    updateNested,
    replaceDraft,
    onSave,
    onRegenerateToken,
    saving,
  } = useProfileForm(id);
  const [mode, setMode] = useState<Mode>("visual");

  if (profileQuery.isLoading) return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (profileQuery.error || !profileQuery.data || !draft) {
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
  }

  const yamlSave = async (data: Profile) => {
    replaceDraft(data);
    await onSave(data);
  };

  const onSaveClick = () => {
    void onSave();
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b bg-card px-4 py-2 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/profiles")}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold truncate text-sm">{draft.name}</span>
            <Badge variant="outline" className="text-xs font-mono">{draft.id}</Badge>
            {dirty && <Badge variant="warning" className="text-xs">未保存</Badge>}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            token=<code className="text-[11px]">{draft.token}</code>
            <button onClick={onRegenerateToken} className="ml-2 text-primary hover:underline text-[11px]">
              重新生成
            </button>
          </div>
        </div>
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
          <TabsList className="h-8">
            <TabsTrigger value="visual" className="text-xs px-3">可视化</TabsTrigger>
            <TabsTrigger value="yaml" className="text-xs px-3">YAML 高级</TabsTrigger>
          </TabsList>
        </Tabs>
        <Button onClick={onSaveClick} disabled={!dirty || saving} size="sm">
          <Save className="h-4 w-4" />
          {saving ? "保存中..." : "保存"}
        </Button>
      </header>

      {mode === "visual" ? (
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex-1 grid min-h-0" style={{ gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1.75fr) minmax(0, 1.25fr)" }}>
            <div className="border-r min-h-0">
              <NodeSelector
                profileId={id}
                draft={draft}
                onChange={update}
                onFilterChange={(patch) => updateNested("node_filter", patch)}
              />
            </div>
            <div className="border-r min-h-0">
              <RulePipeline draft={draft} onChange={(rules) => update({ rule_modules: rules })} />
            </div>
            <div className="min-h-0">
              <RightPanel draft={draft} onChange={update} />
            </div>
          </div>
          <PreviewPane profileId={id} enabled={!dirty} />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <YamlMode draft={draft} onSave={yamlSave} saving={saving} />
        </div>
      )}
    </div>
  );
}
