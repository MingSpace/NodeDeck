import { useRef, useState } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Save, Network, Filter, Link as LinkIcon, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProfileForm } from "./use-profile-form";
import { NodeSelector } from "./node-selector";
import { RulePipeline } from "./rule-pipeline";
import { ProxyGroupsPicker, AdvancedPanel } from "./right-panel";
import { ChainPanel } from "./chain-panel";
import { PreviewPane } from "./preview-pane";
import { YamlMode, type YamlModeHandle } from "./yaml-mode";
import type { Profile } from "./types";

type Mode = "visual" | "yaml";
type Section = "nodes" | "rules" | "chain" | "advanced";

// 编辑区第二层 tab:下划线风格,区别于顶部「可视化 / YAML」的 pill 风格。
const sectionTriggerCls =
  "inline-flex items-center gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

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
  const [section, setSection] = useState<Section>("nodes");
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
    // h-screen + overflow-hidden 锁死整页在视口内:编辑区(左)与实时预览(右)各自内部滚动,整页不出现外层滚动条。
    // 预览面板现在是右侧固定宽度、高度撑满,不会再像旧底部布局那样把 h-screen 撑溢出。
    <div className="flex flex-col h-screen overflow-hidden">
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
          {/* @business_rule: description 字段是可选的,Dashboard 卡片只在非空时显示;此处使用 inline 编辑风格,空状态弱化为占位符 */}
          <input
            type="text"
            value={draft.description ?? ""}
            onChange={(e) => update({ description: e.target.value || undefined })}
            placeholder="添加描述 (可选,会显示在 Dashboard 卡片上)"
            aria-label="Profile 描述"
            spellCheck={false}
            className="mt-1 w-full max-w-[640px] text-xs bg-transparent rounded px-1.5 py-0.5 -ml-1.5 outline-none border border-transparent hover:border-input focus:border-ring focus:bg-background transition-colors text-muted-foreground placeholder:text-muted-foreground/60"
          />
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
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <div className="shrink-0 border-b px-2">
              <Tabs value={section} onValueChange={(v) => setSection(v as Section)}>
                <TabsList className="h-auto gap-0 rounded-none bg-transparent p-0">
                  <TabsTrigger value="nodes" className={sectionTriggerCls}>
                    <Network className="h-3.5 w-3.5" />
                    节点来源
                  </TabsTrigger>
                  <TabsTrigger value="rules" className={sectionTriggerCls}>
                    <Filter className="h-3.5 w-3.5" />
                    规则 & 策略组
                  </TabsTrigger>
                  <TabsTrigger value="chain" className={sectionTriggerCls}>
                    <LinkIcon className="h-3.5 w-3.5" />
                    链式代理
                    {draft.chain_rules.length > 0 && (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        {draft.chain_rules.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="advanced" className={sectionTriggerCls}>
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                    高级输出
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <div className="flex-1 min-h-0">
              {section === "nodes" && (
                <NodeSelector
                  profileId={id}
                  draft={draft}
                  onChange={update}
                  onFilterChange={(patch) => updateNested("node_filter", patch)}
                />
              )}
              {section === "rules" && (
                <div className="flex h-full min-h-0 flex-col">
                  <div className="shrink-0 border-b bg-muted/10">
                    <ProxyGroupsPicker draft={draft} onChange={update} />
                  </div>
                  <div className="min-h-0 flex-1">
                    <RulePipeline draft={draft} onChange={(rules) => update({ rule_modules: rules })} />
                  </div>
                </div>
              )}
              {section === "chain" && (
                <ChainPanel
                  profileId={id}
                  draft={draft}
                  onChange={(chain_rules) => update({ chain_rules })}
                />
              )}
              {section === "advanced" && (
                <AdvancedPanel profileId={id} draft={draft} onChange={update} />
              )}
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
