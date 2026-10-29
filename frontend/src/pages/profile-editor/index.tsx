import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useLocation, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Eye,
  EyeOff,
  Save,
  Network,
  Filter,
  Link as LinkIcon,
  Loader2,
  SlidersHorizontal,
  Waypoints,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UpdatedAt } from "@/components/refreshed-at";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { useEntityUpdatedAt } from "@/api/entities";
import { useProfileForm } from "./use-profile-form";
import { ProfileLoadError } from "./load-error";
import { NodeSelector } from "./node-selector";
import { RulePipeline } from "./rule-pipeline";
import { ProxyGroupsPicker, AdvancedPanel } from "./right-panel";
import { ChainPanel } from "./chain-panel";
import { FlowPanel } from "./flow-panel";
import { PreviewPane } from "./preview-pane";
import { YamlMode, type YamlModeHandle } from "./yaml-mode";
import type { Profile } from "./types";

type Mode = "visual" | "yaml";
const SECTIONS = ["nodes", "rules", "chain", "flow", "advanced"] as const;
type Section = (typeof SECTIONS)[number];

// 编辑区第二层 tab:下划线风格,区别于顶部「可视化 / YAML」的 pill 风格。
const sectionTriggerCls =
  "inline-flex items-center gap-1.5 rounded-none border-b-2 border-transparent bg-transparent px-3 py-2 text-xs font-medium text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none";

export function ProfileEditorPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
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
  const updatedAt = useEntityUpdatedAt("profiles", id);
  const [mode, setMode] = useState<Mode>("visual");
  // 仪表板流水线上点哪一段,就带 ?section= 直接落到对应的标签页
  const [searchParams] = useSearchParams();
  const [section, setSection] = useState<Section>(() => {
    const s = searchParams.get("section");
    return SECTIONS.find((x) => x === s) ?? "nodes";
  });
  const yamlModeRef = useRef<YamlModeHandle>(null);
  const [yamlDirty, setYamlDirty] = useState(false);
  // token 等同订阅密码,默认打码:截图 / 共享屏幕时不会顺手泄露
  const [tokenVisible, setTokenVisible] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);

  // 从仪表板「新建 Profile」跳进来时,名称还是占位的「新 Profile」,直接选中方便改名
  const focusName = (location.state as { focusName?: boolean } | null)?.focusName === true;
  const hasDraft = draft !== null;
  useEffect(() => {
    if (!focusName || !hasDraft) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();
    // 清掉 state,刷新或返回再进来不会又抢焦点
    void navigate(location.pathname, { replace: true, state: null });
  }, [focusName, hasDraft, navigate, location.pathname]);

  // draft 由 effect 从 query data 拷贝而来,所以「data 已到但 draft 还没同步」那一帧也算加载中,
  // 否则会闪一下错误页。反过来,只要 draft 在手就继续给编辑器(后台 refetch 失败不该顶掉正在编辑的内容)。
  if (!draft) {
    if (profileQuery.isError) {
      return (
        <ProfileLoadError
          id={id}
          error={profileQuery.error}
          onRetry={() => void profileQuery.refetch()}
          retrying={profileQuery.isFetching}
        />
      );
    }
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        <span className="text-sm">加载 Profile…</span>
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
    // h-full + overflow-hidden 锁死在 <main> 内:编辑区(左)与实时预览(右)各自内部滚动,整页不出现外层滚动条。
    // 用 h-full 而不是 h-screen:窄屏下 <main> 上方还有一条顶栏,h-screen 会多出顶栏那么高。
    <div className="flex flex-col h-full overflow-hidden">
      {/* 窄屏下名称独占一行,「可视化 / YAML」和保存按钮换到下一行靠右 */}
      <header className="border-b bg-card px-2 py-2 flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0 md:flex-nowrap md:px-4">
        <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
          <ArrowLeft className="h-4 w-4" />
          返回
        </Button>
        <div className="flex-1 min-w-0 basis-[calc(100%-6rem)] md:basis-0">
          <div className="flex items-center gap-2 flex-wrap">
            <input
              ref={nameInputRef}
              type="text"
              value={draft.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="未命名 Profile"
              aria-label="Profile 名称"
              spellCheck={false}
              title={`点击编辑 Profile 名称(id: ${draft.id})`}
              className={
                "font-semibold text-sm bg-transparent rounded px-1.5 py-0.5 -ml-1.5 outline-none border transition-colors min-w-[120px] max-w-[260px] " +
                (nameValid
                  ? "border-transparent hover:border-input focus:border-ring focus:bg-background"
                  : "border-destructive/60 focus:border-destructive focus:bg-background")
              }
            />
            <UpdatedAt ts={updatedAt} className="text-xs text-muted-foreground" />
            {isDirty && <Badge variant="warning" className="text-xs">未保存</Badge>}
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
            <span>订阅 token</span>
            <code className="font-mono">{tokenVisible ? draft.token : "•".repeat(10)}</code>
            <button
              type="button"
              onClick={() => setTokenVisible((v) => !v)}
              className="inline-flex items-center gap-1 hover:text-foreground"
              aria-label={tokenVisible ? "隐藏 token" : "显示 token"}
            >
              {tokenVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {tokenVisible ? "隐藏" : "显示"}
            </button>
            <button type="button" onClick={() => setConfirmRegen(true)} className="text-primary hover:underline">
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
        <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="ml-auto md:ml-0">
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
            <div className="shrink-0 overflow-x-auto border-b px-2">
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
                      <Badge variant="secondary" className="px-1.5 py-0 text-xs">
                        {draft.chain_rules.length}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="flow" className={sectionTriggerCls}>
                    <Waypoints className="h-3.5 w-3.5" />
                    流转
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
                  onHiddenNodesChange={(hidden_nodes) => update({ hidden_nodes })}
                />
              )}
              {section === "flow" && <FlowPanel profileId={id} draft={draft} />}
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

      <ConfirmDialog
        open={confirmRegen}
        onOpenChange={setConfirmRegen}
        title="重新生成订阅 token?"
        description="旧的订阅链接会立即失效,已经导入的 Clash / Surge 客户端需要重新复制链接导入。"
        confirmLabel="重新生成"
        onConfirm={() => void onRegenerateToken()}
      />
    </div>
  );
}
