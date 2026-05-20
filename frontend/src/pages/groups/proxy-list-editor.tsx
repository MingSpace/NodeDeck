import { useMemo, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  closestCenter,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, GripVertical, Info, Pin, PinOff, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export interface NodeCandidate {
  name: string;
  type: string;
  source_provider_id?: string;
}

export interface GroupCandidate {
  id: string;
  name: string;
}

export interface ProviderRef {
  id: string;
  name: string;
}

// @business_rule: 与后端 backend/src/generators/group-refs.ts:13-21 的 GROUP_BUILTIN_POLICIES
// 保持同步,只暴露常用的 5 项 (PASS / COMPATIBLE 是 mihomo 罕用项,不主动展示给用户避免误用)。
const BUILTIN_POLICIES = ["DIRECT", "REJECT", "REJECT-DROP", "REJECT-NO-DROP", "REJECT-TINYGIF"] as const;
const BUILTIN_SET = new Set<string>(BUILTIN_POLICIES);

interface Props {
  proxies: string[];
  onChange: (arr: string[]) => void;
  /** selector.include_other_group 当前值 (其它策略组 id 数组) */
  includeOtherGroup: string[];
  onIncludeOtherGroupChange: (arr: string[]) => void;
  candidateNodes: NodeCandidate[];
  candidateGroups: GroupCandidate[];
  providers: ProviderRef[];
  onRefreshNodes?: () => void;
  isLoadingNodes?: boolean;
  hasAnyProvider?: boolean;
  /** selector.from_providers 是否非空 — 影响候选区空状态文案 */
  hasFromProviders?: boolean;
  /** 整个节点池(/api/dashboard/node-pool)的全量节点数 — 用于状态栏让用户感知 selector 筛掉了多少 */
  totalNodePoolSize: number;
  /**
   * 全量节点池的所有节点名集合,用于在「已锁定」段对每行做三态分类:
   *   - 在 candidateNodes(selector 命中)里 → 普通行
   *   - 不在 candidateNodes 但在 allPoolNodeNames → "已锁定但 selector 不命中" 灰色 hint
   *   - 完全不在节点池 + 不是内置 policy → "未知引用" 警告 (含误把组名写进 g.proxies 的情形)
   * 与 candidateNodes 是不同集合: candidateNodes 受 selector 收窄, allPoolNodeNames 是全量。
   */
  allPoolNodeNames: Set<string>;
}

// @business_rule: 三态划分用于「已锁定」段每行徽标。
// 规范: g.proxies 数组里**只**放节点名 + 内置 policy (DIRECT / REJECT*);
// 其它策略组的引用一律走 selector.include_other_group 数组 (UI 里"合并自..."段)。
// 因此这里识别的是 "这个名字是不是池里的节点 / 内置 policy", 组名会被归到 unknown 提醒用户挪走。
//   node-in: 在当前 selector 命中节点池 ∪ 内置 policy → 不显示额外徽标 (正常行/由 isSpecial 走"内置"徽标)
//   node-out: 在全量节点池里但 selector 不命中 → 灰色"selector 不命中" hint
//             (订阅里仍输出, 锁定优先于 selector; 提示用户考虑解锁或放宽 selector)
//   unknown: 完全不在节点池且不是内置 policy → 橘色"未知引用" 警告
//            (机场改名 / 节点被删 / 拼写错误 / 把组名误写进 g.proxies)
type RowClassification = "node-in" | "node-out" | "unknown";

export function ProxyListEditor({
  proxies,
  onChange,
  includeOtherGroup,
  onIncludeOtherGroupChange,
  candidateNodes,
  candidateGroups,
  providers,
  onRefreshNodes,
  isLoadingNodes,
  hasAnyProvider,
  hasFromProviders,
  totalNodePoolSize,
  allPoolNodeNames,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const items = proxies.map((p, i) => ({ id: `proxy-${i}-${p}`, idx: i, name: p }));

  const candidateNamesSet = useMemo(() => {
    const s = new Set<string>();
    candidateNodes.forEach((n) => s.add(n.name));
    return s;
  }, [candidateNodes]);

  const classifyRowName = (name: string): RowClassification => {
    if (candidateNamesSet.has(name) || BUILTIN_SET.has(name)) return "node-in";
    if (allPoolNodeNames.has(name)) return "node-out";
    return "unknown";
  };

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onChange(arrayMove(proxies, oldIdx, newIdx));
  };

  // @business_rule: selector.include_other_group 数组顺序敏感 — 后端 generator 按数组顺序
  // 展开各组的成员节点拼到当前组的 yaml proxies 列表里,顺序影响客户端 url-test/fallback
  // 的优先级。所以独立给一个 DnD 上下文,跟节点段的 proxies 互不干扰。
  const groupItemIds = useMemo(() => includeOtherGroup.map((g) => `group-${g}`), [includeOtherGroup]);
  const onGroupDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = groupItemIds.indexOf(String(active.id));
    const newIdx = groupItemIds.indexOf(String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;
    onIncludeOtherGroupChange(arrayMove(includeOtherGroup, oldIdx, newIdx));
  };

  return (
    <div className="space-y-2">
      <Picker
        proxies={proxies}
        onChange={onChange}
        candidateNodes={candidateNodes}
        providers={providers}
        onRefreshNodes={onRefreshNodes}
        isLoadingNodes={isLoadingNodes}
        hasAnyProvider={hasAnyProvider}
        hasFromProviders={hasFromProviders}
        totalNodePoolSize={totalNodePoolSize}
      />

      {/* @user_flow: 已锁定列表分两段展示:
          (1) g.proxies 数组里的节点 / 内置 policy — DnD 调整顺序;
          (2) selector.include_other_group 选中的组 — 独立 DnD 段 (两个字段顺序敏感, 互不干扰)。
          每段都是「整行可拖」(整个边框可点击拖拽), 删除按钮的 pointerdown 被 stop 掉避免误触发拖拽。 */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5 pt-1">
        <span>
          已锁定 · 节点 {proxies.length}
          {includeOtherGroup.length > 0 && ` + 合并组 ${includeOtherGroup.length}`}
        </span>
        {(proxies.length > 0 || includeOtherGroup.length > 0) && <span>整行可拖动调整顺序</span>}
      </div>

      {proxies.length === 0 && includeOtherGroup.length === 0 ? (
        <div className="text-xs text-muted-foreground border border-dashed rounded p-3 leading-relaxed">
          当前未锁定任何节点 — selector 命中的节点会按节点池顺序自动包含在订阅里(含未来 provider 新增的同类节点)。
          只有需要固定顺序时(如 fallback / url-test 优先),才需要在上方候选区点
          <Pin className="inline h-3 w-3 mx-1 -translate-y-px" />
          锁定。
        </div>
      ) : (
        <div className="space-y-1">
          {proxies.length > 0 && (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  {items.map(({ id, idx, name }) => (
                    <SortableRow
                      key={id}
                      id={id}
                      name={name}
                      classification={classifyRowName(name)}
                      onRemove={() => onChange(proxies.filter((_, i) => i !== idx))}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}

          {includeOtherGroup.length > 0 && (
            <>
              <div className="text-[10px] text-muted-foreground px-0.5 pt-1.5 italic">
                合并自 selector.include_other_group (整组成员动态注入, 顺序敏感, 可拖动):
              </div>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onGroupDragEnd}>
                <SortableContext items={groupItemIds} strategy={verticalListSortingStrategy}>
                  <div className="space-y-1">
                    {includeOtherGroup.map((groupId) => {
                      const display = candidateGroups.find((g) => g.id === groupId);
                      const danglingHint = !display ? "组已不存在或被禁用" : null;
                      return (
                        <SortableGroupRefRow
                          key={`group-${groupId}`}
                          id={`group-${groupId}`}
                          name={display?.name ?? groupId}
                          danglingHint={danglingHint}
                          onRemove={() =>
                            onIncludeOtherGroupChange(includeOtherGroup.filter((id) => id !== groupId))
                          }
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Picker({
  proxies,
  onChange,
  candidateNodes,
  providers,
  onRefreshNodes,
  isLoadingNodes,
  hasAnyProvider,
  hasFromProviders,
  totalNodePoolSize,
}: {
  proxies: string[];
  onChange: (arr: string[]) => void;
  candidateNodes: NodeCandidate[];
  providers: ProviderRef[];
  onRefreshNodes?: () => void;
  isLoadingNodes?: boolean;
  hasAnyProvider?: boolean;
  hasFromProviders?: boolean;
  totalNodePoolSize: number;
}) {
  const [search, setSearch] = useState("");

  const pinnedSet = useMemo(() => new Set(proxies), [proxies]);

  // @business_rule: 锁定序号 = 该节点名在 g.proxies 数组中的 index + 1。
  // 与下方「已锁定」段拖拽顺序一致,用户拖拽时序号也会随之变化(因为 proxies 数组顺序变了)。
  const pinnedIndexMap = useMemo(() => {
    const m = new Map<string, number>();
    proxies.forEach((p, i) => m.set(p, i + 1));
    return m;
  }, [proxies]);

  const providerNameMap = useMemo(() => {
    const m = new Map<string, string>();
    providers.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [providers]);

  // @user_flow: 搜索同时匹配 name / type / provider id / provider name,
  // 这样按机场名搜也能命中。大小写不敏感。
  const filteredNodes = useMemo(() => {
    const f = search.trim().toLowerCase();
    if (!f) return candidateNodes;
    return candidateNodes.filter((n) => {
      if (n.name.toLowerCase().includes(f)) return true;
      if (n.type.toLowerCase().includes(f)) return true;
      const provId = n.source_provider_id ?? "";
      if (provId.toLowerCase().includes(f)) return true;
      const provName = providerNameMap.get(provId) ?? "";
      return provName.toLowerCase().includes(f);
    });
  }, [candidateNodes, search, providerNameMap]);

  const visibleNodeNames = useMemo(() => filteredNodes.map((n) => n.name), [filteredNodes]);
  const visibleSet = useMemo(() => new Set(visibleNodeNames), [visibleNodeNames]);
  const visiblePinnedCount = useMemo(() => {
    let c = 0;
    for (const n of filteredNodes) if (pinnedSet.has(n.name)) c++;
    return c;
  }, [filteredNodes, pinnedSet]);
  const visibleAutoCount = filteredNodes.length - visiblePinnedCount;

  const togglePin = (name: string) => {
    if (pinnedSet.has(name)) onChange(proxies.filter((p) => p !== name));
    else onChange([...proxies, name]);
  };

  // @business_rule: 批量操作严格限定在当前搜索过滤可见的节点,不影响内置 policy chip 的锁定状态。
  // 这样改 from_providers / regex 后,工具栏不会误删 DIRECT 之类的 fallback。
  const pinAllVisible = () => {
    const toAdd = visibleNodeNames.filter((n) => !pinnedSet.has(n));
    if (toAdd.length === 0) return;
    onChange([...proxies, ...toAdd]);
  };

  const unpinAllVisible = () => {
    if (visiblePinnedCount === 0) return;
    onChange(proxies.filter((p) => !visibleSet.has(p)));
  };

  return (
    <div className="border rounded-md bg-card">
      {/* @user_flow: 顶部固定说明 — 这是整套语义重写后的核心引导,告诉用户
          1) selector 命中节点已经自动包含在订阅里 (无需勾选/锁定)
          2) 只有需要固定 fallback / url-test 顺序时才需要锁定
          避免用户陷入"必须勾选才会生效"的旧心智模型。 */}
      <div className="flex items-start gap-2 px-2 py-1.5 border-b bg-muted/30">
        <Info className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
        <p className="text-[11px] text-muted-foreground leading-snug">
          以下节点已通过 selector{" "}
          <span className="font-medium text-foreground">自动包含</span>
          {" "}在订阅里(含未来 provider 新增的同类节点),无需操作。仅当需要
          <span className="font-medium text-foreground">固定 fallback / url-test 优先顺序</span>
          时,才点
          <Pin className="inline h-3 w-3 mx-0.5 -translate-y-px" />
          把节点锁定到下方显式列表。
        </p>
      </div>

      <div className="flex items-center gap-2 px-2 py-1.5 border-b">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索节点 (name / type / 节点源)..."
          className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-1"
        />
        {onRefreshNodes && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onRefreshNodes}
            disabled={isLoadingNodes}
            title="刷新节点池"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoadingNodes ? "animate-spin" : ""}`} />
          </Button>
        )}
      </div>

      {/* @user_flow: 内置 policy 5 项常驻 chip 行,点击切换加入/移除(双向同步 g.proxies)。
          DIRECT/REJECT 这些不属于"节点池",所以仍是直接显式写入 g.proxies,锁定语义。 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b flex-wrap">
        <span className="text-[11px] text-muted-foreground shrink-0 mr-0.5">快捷:</span>
        {BUILTIN_POLICIES.map((p) => {
          const added = pinnedSet.has(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => togglePin(p)}
              className={
                added
                  ? "px-2 py-0.5 rounded text-[11px] font-mono font-medium border bg-primary text-primary-foreground border-primary inline-flex items-center gap-1"
                  : "px-2 py-0.5 rounded text-[11px] font-mono font-medium border bg-background text-foreground hover:bg-accent border-input inline-flex items-center gap-1"
              }
              title={added ? `已锁定 ${p} (点击解锁)` : `锁定 ${p} 到显式列表`}
            >
              {added && <Pin className="h-2.5 w-2.5" strokeWidth={2.5} />}
              {p}
            </button>
          );
        })}
      </div>

      {/* @user_flow: 状态栏三个数语义不重叠 —
          已锁定 = 当前可见(搜索框过滤后)且在 g.proxies 显式数组里的节点数
          自动包含 = 可见但未锁定 → 后端按节点池顺序追加在锁定段之后
          节点池 = /api/dashboard/node-pool 全量,让用户感知 selector 筛掉了多少。 */}
      <div className="flex items-center gap-2 px-2 py-1 border-b text-[11px]">
        <span className="text-muted-foreground">
          已锁定{" "}
          <span className="font-medium text-foreground tabular-nums">{visiblePinnedCount}</span>
          {" · "}自动包含{" "}
          <span className="font-medium text-foreground tabular-nums">{visibleAutoCount}</span>
          {" · "}节点池{" "}
          <span className="tabular-nums">{totalNodePoolSize}</span>
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={pinAllVisible}
          disabled={visibleAutoCount === 0}
          title="把当前可见且未锁定的节点全部加入显式列表(通常仅在需要固定 fallback 顺序时才用)"
        >
          <Pin className="h-3 w-3 mr-1" />
          全部锁定
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={unpinAllVisible}
          disabled={visiblePinnedCount === 0}
          title="把当前可见的已锁定节点全部解锁(仍由 selector 自动包含)"
        >
          <PinOff className="h-3 w-3 mr-1" />
          全部解锁
        </Button>
      </div>

      <div className="max-h-[280px] overflow-auto">
        {candidateNodes.length === 0 ? (
          <EmptyHint>
            {!hasAnyProvider
              ? "暂无节点源 — 请先到「节点源」页面新建一个机场订阅或「静态节点」类型的源"
              : !hasFromProviders
                ? "请先在上方 from_providers 选择机场,候选节点池才会展示。空选 = UI 不显示节点 (后端导出时仍会按 selector 语义处理)。"
                : "from_providers 已选机场但未匹配到任何节点 — 可能机场未启用 / 尚未拉到节点 / 选错。可点右上角 ⟳ 刷新节点池"}
          </EmptyHint>
        ) : filteredNodes.length === 0 ? (
          <EmptyHint>无匹配节点</EmptyHint>
        ) : (
          <div className="divide-y">
            {filteredNodes.map((n) => {
              const sourceLabel = n.source_provider_id
                ? providerNameMap.get(n.source_provider_id) ?? n.source_provider_id
                : null;
              const pinned = pinnedSet.has(n.name);
              const pinIndex = pinnedIndexMap.get(n.name);
              return (
                <NodePickerRow
                  key={`node-${n.source_provider_id ?? "?"}-${n.name}`}
                  node={n}
                  pinned={pinned}
                  pinIndex={pinIndex}
                  sourceLabel={sourceLabel}
                  onTogglePin={() => togglePin(n.name)}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 text-xs text-muted-foreground italic leading-relaxed">{children}</div>;
}

function NodePickerRow({
  node,
  pinned,
  pinIndex,
  sourceLabel,
  onTogglePin,
}: {
  node: NodeCandidate;
  pinned: boolean;
  pinIndex?: number;
  sourceLabel: string | null;
  onTogglePin: () => void;
}) {
  // @user_flow: 整行 onClick 切换锁定状态;右侧 Pin/PinOff 按钮提供更明显的 affordance,
  // 点按钮时阻止冒泡避免双触发。Pinned 时左侧徽标显示 `📌 #序号`,Auto 时显示绿色"自动"徽标。
  return (
    <div
      className="flex items-center gap-2 px-2 py-1 hover:bg-muted/40 text-xs cursor-pointer select-none"
      onClick={onTogglePin}
      role="button"
      aria-label={pinned ? `解锁 ${node.name}` : `锁定 ${node.name} 到显式列表`}
    >
      {pinned ? (
        <Badge
          variant="default"
          className="text-[10px] px-1.5 py-0 shrink-0 gap-0.5 inline-flex items-center font-medium tabular-nums"
          title={pinIndex !== undefined ? `已锁定 — 在显式列表第 ${pinIndex} 位` : "已锁定"}
        >
          <Pin className="h-2.5 w-2.5" strokeWidth={2.5} />
          {pinIndex !== undefined ? `#${pinIndex}` : ""}
        </Badge>
      ) : (
        <Badge
          variant="success"
          className="text-[10px] px-1.5 py-0 shrink-0 font-medium"
          title="该节点会被 selector 自动包含在订阅里。点击可锁定它在显式列表中的位置(用于固定 fallback / url-test 优先顺序)"
        >
          自动
        </Badge>
      )}
      <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 shrink-0">
        {node.type}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{node.name}</div>
      </div>
      {sourceLabel ? (
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 shrink-0 max-w-[180px] truncate"
          title={`来自节点源: ${sourceLabel}`}
        >
          {sourceLabel}
        </Badge>
      ) : (
        <Badge
          variant="outline"
          className="text-[10px] px-1.5 py-0 shrink-0 text-muted-foreground"
          title="manual 节点 / provider 已删除"
        >
          (无来源)
        </Badge>
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={(e) => {
          e.stopPropagation();
          onTogglePin();
        }}
        title={pinned ? "解锁 (移出显式列表,仍由 selector 自动包含)" : "锁定到显式列表 (固定顺序)"}
      >
        {pinned ? (
          <PinOff className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <Pin className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}

// @user_flow: 整行 (整个边框) 都是 drag handle — {...attributes} {...listeners} 直接绑在外层 div,
// 配合 PointerSensor 的 activationConstraint distance:4 — 短点击不会触发拖,只有移动 ≥4px 才进入拖拽。
// 删除按钮的 onPointerDown 阻止冒泡,避免按下按钮也开始拖拽。
const stopDragOnPointerDown = (e: React.PointerEvent) => e.stopPropagation();

function SortableGroupRefRow({
  id,
  name,
  danglingHint,
  onRemove,
}: {
  id: string;
  name: string;
  danglingHint: string | null;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-2 border rounded-md p-1.5 bg-card cursor-grab active:cursor-grabbing touch-none select-none"
      title="拖动调整顺序"
    >
      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
      <Badge variant="secondary" className="text-[10px] uppercase shrink-0">
        组
      </Badge>
      {danglingHint && (
        <Badge
          variant="outline"
          className="text-[10px] text-amber-700 dark:text-amber-300 border-amber-500/50 bg-amber-500/10 gap-1 shrink-0"
          title={danglingHint}
        >
          <AlertTriangle className="h-3 w-3" />
          {danglingHint}
        </Badge>
      )}
      <span className="text-xs flex-1 min-w-0 truncate">{name}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onRemove}
        onPointerDown={stopDragOnPointerDown}
        title="从 selector.include_other_group 移除"
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

function SortableRow({
  id,
  name,
  classification,
  onRemove,
}: {
  id: string;
  name: string;
  classification: RowClassification;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isSpecial = BUILTIN_SET.has(name);
  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="flex items-center gap-2 border rounded-md p-1.5 bg-card cursor-grab active:cursor-grabbing touch-none select-none"
      title="拖动调整顺序"
    >
      <GripVertical className="h-4 w-4 text-muted-foreground shrink-0" />
      {isSpecial && (
        <Badge variant="secondary" className="text-[10px] uppercase shrink-0">
          内置
        </Badge>
      )}
      {/* @user_flow: 三态 hint 一目了然(只在非 builtin 行显示):
          - node-in: 当前 selector 命中 → 不额外标 (整行就是普通锁定项)
          - node-out: 节点在池里但 selector 不命中 → 灰色"selector 不命中"
                      (订阅里仍输出, 因为锁定优先于 selector 过滤; 提示用户考虑解锁)
          - unknown: 完全不在节点池且不是 builtin → 橘色"未知引用"警告
                     (机场改名 / 节点被删 / 拼写错误 / 把组名误写进 g.proxies 而非 selector.include_other_group) */}
      {!isSpecial && classification === "node-out" && (
        <Badge
          variant="outline"
          className="text-[10px] text-muted-foreground border-muted-foreground/30 bg-muted/40 gap-1 shrink-0"
          title="该节点在节点池里存在,但当前 selector 不命中(被 from_providers / include_regex / exclude_type 过滤掉)。订阅里仍会输出它,因为锁定优先于 selector;如不需要可解锁。"
        >
          <Info className="h-3 w-3" />
          selector 不命中
        </Badge>
      )}
      {!isSpecial && classification === "unknown" && (
        <Badge
          variant="outline"
          className="text-[10px] text-amber-700 dark:text-amber-300 border-amber-500/50 bg-amber-500/10 gap-1 shrink-0"
          title="该引用名当前不在节点池且不是内置 policy,可能已失效(机场改名 / 节点被删 / 拼写错误)。如果是组名,请挪到 selector.include_other_group 数组里"
        >
          <AlertTriangle className="h-3 w-3" />
          未知引用
        </Badge>
      )}
      <span className="text-xs flex-1 min-w-0 truncate">{name}</span>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onRemove}
        onPointerDown={stopDragOnPointerDown}
        title="从列表移除"
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}
