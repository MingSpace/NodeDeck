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
import { AlertTriangle, Check, GripVertical, RefreshCw, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";

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
}

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
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const items = proxies.map((p, i) => ({ id: `proxy-${i}-${p}`, idx: i, name: p }));

  // @business_rule: 候选名集合(节点 + 策略组 + 内置 policy)用于给已加入行打 unknown 徽标。
  // candidateGroups 仍参与,虽然 Picker 不再展示「策略组」Section,但历史 proxies 里
  // 的策略组引用(如 "Japan(DIP)")不应被误标为 unknown。语义合并到 selector.include_other_group。
  const knownNames = useMemo(() => {
    const s = new Set<string>();
    candidateNodes.forEach((n) => s.add(n.name));
    candidateGroups.forEach((g) => s.add(g.name));
    BUILTIN_POLICIES.forEach((p) => s.add(p));
    return s;
  }, [candidateNodes, candidateGroups]);

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

      {/* @user_flow: 已加入列表合并展示 (1) proxies 数组里的节点 / 内置 policy / 历史组引用 — DnD 调整顺序;
          (2) selector.include_other_group 选中的组 — 独立 DnD 段(分别更新两个字段,互不干扰)。
          每段都是「整行可拖」(整个边框可点击拖拽),删除按钮的 pointerdown 被 stop 掉避免误触发拖拽。 */}
      <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5 pt-1">
        <span>
          已加入 · 节点 {proxies.length}
          {includeOtherGroup.length > 0 && ` + 合并组 ${includeOtherGroup.length}`}
        </span>
        {(proxies.length > 0 || includeOtherGroup.length > 0) && <span>整行可拖动调整顺序</span>}
      </div>

      {proxies.length === 0 && includeOtherGroup.length === 0 ? (
        <div className="text-xs text-muted-foreground border border-dashed rounded p-3 text-center">
          暂无显式成员 (selector 可动态注入)
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
                      unknown={!knownNames.has(name)}
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

  const selectedSet = useMemo(() => new Set(proxies), [proxies]);

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
  const visibleSelectedCount = useMemo(() => {
    let c = 0;
    for (const n of filteredNodes) if (selectedSet.has(n.name)) c++;
    return c;
  }, [filteredNodes, selectedSet]);

  const allVisibleSelected = filteredNodes.length > 0 && visibleSelectedCount === filteredNodes.length;
  const noneVisibleSelected = visibleSelectedCount === 0;
  const headerCheckboxState: boolean | "indeterminate" = allVisibleSelected
    ? true
    : noneVisibleSelected
      ? false
      : "indeterminate";

  const toggleOne = (name: string) => {
    if (selectedSet.has(name)) onChange(proxies.filter((p) => p !== name));
    else onChange([...proxies, name]);
  };

  // @business_rule: 三个批量操作的作用域**严格限定在当前过滤可见的节点**,不影响内置 policy chip
  // 的状态和历史策略组引用。这样改 from_providers / regex 后,工具栏不会误删 DIRECT 之类的 fallback。
  const selectAllVisible = () => {
    const toAdd = visibleNodeNames.filter((n) => !selectedSet.has(n));
    if (toAdd.length === 0) return;
    onChange([...proxies, ...toAdd]);
  };

  const deselectAllVisible = () => {
    if (visibleSelectedCount === 0) return;
    onChange(proxies.filter((p) => !visibleSet.has(p)));
  };

  const invertVisibleSelection = () => {
    if (filteredNodes.length === 0) return;
    const kept = proxies.filter((p) => !visibleSet.has(p));
    const toAdd = visibleNodeNames.filter((n) => !selectedSet.has(n));
    onChange([...kept, ...toAdd]);
  };

  const onHeaderCheckboxToggle = () => {
    if (allVisibleSelected) deselectAllVisible();
    else selectAllVisible();
  };

  return (
    <div className="border rounded-md bg-card">
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

      {/* @user_flow: 内置 policy 5 项常驻 chip 行,点击切换加入/移除(双向同步)。
          原来的「内置 policy」独立 Section 折叠到这里,节省垂直空间。 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-b flex-wrap">
        <span className="text-[11px] text-muted-foreground shrink-0 mr-0.5">快捷:</span>
        {BUILTIN_POLICIES.map((p) => {
          const added = selectedSet.has(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => toggleOne(p)}
              className={
                added
                  ? "px-2 py-0.5 rounded text-[11px] font-mono font-medium border bg-primary text-primary-foreground border-primary inline-flex items-center gap-1"
                  : "px-2 py-0.5 rounded text-[11px] font-mono font-medium border bg-background text-foreground hover:bg-accent border-input inline-flex items-center gap-1"
              }
              title={added ? "已加入 (点击移除)" : `添加 ${p}`}
            >
              {added && <Check className="h-3 w-3" strokeWidth={3} />}
              {p}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2 px-2 py-1 border-b text-[11px]">
        <Checkbox
          checked={headerCheckboxState}
          onCheckedChange={() => onHeaderCheckboxToggle()}
          disabled={filteredNodes.length === 0}
          aria-label="全选可见节点"
        />
        {/* @user_flow: 三个数语义不重叠 —
            已选 = 当前可见(搜索框过滤后)且已加入 proxies 的节点数;
            可见 = Picker 内搜索框过滤后剩余的候选;
            节点池 = /api/dashboard/node-pool 全量(未被 from_providers/regex/exclude_type 筛过),
            让用户能直观感知 selector 筛掉了多少。 */}
        <span className="text-muted-foreground">
          已选 {visibleSelectedCount} · 可见 {filteredNodes.length} · 节点池 {totalNodePoolSize}
        </span>
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={invertVisibleSelection}
          disabled={filteredNodes.length === 0}
          title="在当前可见范围内反转选中状态"
        >
          反选
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px]"
          onClick={deselectAllVisible}
          disabled={visibleSelectedCount === 0}
          title="移除当前可见且已选的节点"
        >
          清空可见已选
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
              return (
                <NodeCheckRow
                  key={`node-${n.source_provider_id ?? "?"}-${n.name}`}
                  node={n}
                  checked={selectedSet.has(n.name)}
                  sourceLabel={sourceLabel}
                  onToggle={() => toggleOne(n.name)}
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

function NodeCheckRow({
  node,
  checked,
  sourceLabel,
  onToggle,
}: {
  node: NodeCandidate;
  checked: boolean;
  sourceLabel: string | null;
  onToggle: () => void;
}) {
  return (
    // @user_flow: 整行 onClick 切换 checkbox。Checkbox 自身 pointerEvents:none + tabIndex:-1
    // 避免重复触发(点 checkbox 不会冒泡再次切换),只展示状态。
    <div
      className="flex items-center gap-2 px-2 py-1 hover:bg-muted/40 text-xs cursor-pointer select-none"
      onClick={onToggle}
      role="checkbox"
      aria-checked={checked}
    >
      <Checkbox
        checked={checked}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none"
      />
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
  unknown,
  onRemove,
}: {
  id: string;
  name: string;
  unknown: boolean;
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
      {unknown && !isSpecial && (
        <Badge
          variant="outline"
          className="text-[10px] text-amber-700 dark:text-amber-300 border-amber-500/50 bg-amber-500/10 gap-1 shrink-0"
          title="该引用名当前不在节点池 / 策略组 / 内置 policy 中,可能已失效"
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
