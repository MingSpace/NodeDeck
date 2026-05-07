import { useRef, useState } from "react";
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
import { YamlMode, type YamlModeHandle } from "./yaml-mode";
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
  const yamlModeRef = useRef<YamlModeHandle>(null);
  const [yamlDirty, setYamlDirty] = useState(false);

  if (profileQuery.isLoading) return <div className="p-8 text-muted-foreground">加载中...</div>;
  if (profileQuery.error || !profileQuery.data || !draft) {
    return (
      <div className="p-8">
        <Button asChild variant="outline">
          <Link to="/dashboard">
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

  const isDirty = mode === "yaml" ? dirty || yamlDirty : dirty;
  const nameValid = draft.name.trim().length > 0;
  const canSave = isDirty && !saving && (mode === "yaml" || nameValid);

  const onSaveClick = () => {
    if (mode === "yaml") {
      void yamlModeRef.current?.save();
    } else {
      void onSave();
    }
  };

  return (
    <div className="flex flex-col h-screen">
      <header className="border-b bg-card px-4 py-2 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="未命名 Profile"
              aria-label="Profile 名称"
              spellCheck={false}
              title="点击编辑 Profile 名称"
              className={
                "font-semibold text-sm bg-transparent rounded px-1.5 py-0.5 -ml-1.5 outline-none border transition-colors min-w-[120px] max-w-[260px] " +
                (nameValid
                  ? "border-transparent hover:border-input focus:border-ring focus:bg-background"
                  : "border-destructive/60 focus:border-destructive focus:bg-background")
              }
            />
            <Badge variant="outline" className="text-xs font-mono">{draft.id}</Badge>
            {isDirty && <Badge variant="warning" className="text-xs">未保存</Badge>}
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
        <Button
          onClick={onSaveClick}
          disabled={!canSave}
          size="sm"
          title={!nameValid && mode === "visual" ? "请先填写 Profile 名称" : undefined}
        >
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
          <PreviewPane profileId={id} draft={draft} enabled={true} />
        </div>
      ) : (
        <div className="flex-1 min-h-0">
          <YamlMode
            ref={yamlModeRef}
            draft={draft}
            onSave={yamlSave}
            onDirtyChange={setYamlDirty}
          />
        </div>
      )}
    </div>
  );
}
