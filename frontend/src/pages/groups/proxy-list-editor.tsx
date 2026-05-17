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
import { AlertTriangle, GripVertical, Plus, RefreshCw, Search, Trash2 } from "lucide-react";
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

// @business_rule: 与后端 backend/src/generators/group-refs.ts:13-21 的 GROUP_BUILTIN_POLICIES
// 保持同步,只暴露常用的 5 项 (PASS / COMPATIBLE 是 mihomo 罕用项,不主动展示给用户避免误用)。
const BUILTIN_POLICIES = ["DIRECT", "REJECT", "REJECT-DROP", "REJECT-NO-DROP", "REJECT-TINYGIF"] as const;
const BUILTIN_SET = new Set<string>(BUILTIN_POLICIES);

interface Props {
  proxies: string[];
  onChange: (arr: string[]) => void;
  candidateNodes: NodeCandidate[];
  candidateGroups: GroupCandidate[];
  onRefreshNodes?: () => void;
  isLoadingNodes?: boolean;
  hasAnyProvider?: boolean;
}

export function ProxyListEditor({
  proxies,
  onChange,
  candidateNodes,
  candidateGroups,
  onRefreshNodes,
  isLoadingNodes,
  hasAnyProvider,
}: Props) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const items = proxies.map((p, i) => ({ id: `proxy-${i}-${p}`, idx: i, name: p }));

  // @business_rule: 候选名集合(节点 + 策略组 + 内置 policy)用于给已加入行打 unknown 徽标。
  // 不在任何候选池里的引用 → 大概率是历史数据(provider 被删 / 节点改名),提醒用户清理。
  const knownNames = useMemo(() => {
    const s = new Set<string>();
    candidateNodes.forEach((n) => s.add(n.name));
    candidateGroups.forEach((g) => s.add(g.name));
    BUILTIN_POLICIES.forEach((p) => s.add(p));
    return s;
  }, [candidateNodes, candidateGroups]);

  const selectedSet = useMemo(() => new Set(proxies), [proxies]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onChange(arrayMove(proxies, oldIdx, newIdx));
  };

  // @user_flow: 点击候选项 → 追加到列表末尾;若已添加则忽略(防御性,UI 上按钮已隐藏)。
  const addOne = (name: string) => {
    if (selectedSet.has(name)) return;
    onChange([...proxies, name]);
  };

  return (
    <div className="space-y-2">
      <Picker
        candidateNodes={candidateNodes}
        candidateGroups={candidateGroups}
        selectedSet={selectedSet}
        onAdd={addOne}
        onRefreshNodes={onRefreshNodes}
        isLoadingNodes={isLoadingNodes}
        hasAnyProvider={hasAnyProvider}
      />

      <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5 pt-1">
        <span>已加入 · {proxies.length} 个</span>
        {proxies.length > 0 && <span>拖动 ⋮⋮ 调整顺序</span>}
      </div>

      {proxies.length === 0 ? (
        <div className="text-xs text-muted-foreground border border-dashed rounded p-3 text-center">
          暂无显式成员 (selector 可动态注入)
        </div>
      ) : (
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
    </div>
  );
}

function Picker({
  candidateNodes,
  candidateGroups,
  selectedSet,
  onAdd,
  onRefreshNodes,
  isLoadingNodes,
  hasAnyProvider,
}: {
  candidateNodes: NodeCandidate[];
  candidateGroups: GroupCandidate[];
  selectedSet: Set<string>;
  onAdd: (name: string) => void;
  onRefreshNodes?: () => void;
  isLoadingNodes?: boolean;
  hasAnyProvider?: boolean;
}) {
  const [search, setSearch] = useState("");

  const filteredNodes = useMemo(() => {
    const f = search.trim().toLowerCase();
    if (!f) return candidateNodes;
    return candidateNodes.filter(
      (n) =>
        n.name.toLowerCase().includes(f) ||
        n.type.toLowerCase().includes(f) ||
        (n.source_provider_id ?? "").toLowerCase().includes(f),
    );
  }, [candidateNodes, search]);

  const filteredGroups = useMemo(() => {
    const f = search.trim().toLowerCase();
    if (!f) return candidateGroups;
    return candidateGroups.filter(
      (g) => g.name.toLowerCase().includes(f) || g.id.toLowerCase().includes(f),
    );
  }, [candidateGroups, search]);

  const filteredBuiltins = useMemo(() => {
    const f = search.trim().toLowerCase();
    if (!f) return BUILTIN_POLICIES as readonly string[];
    return BUILTIN_POLICIES.filter((p) => p.toLowerCase().includes(f));
  }, [search]);

  return (
    <div className="border rounded-md bg-card">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b">
        <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索可添加的节点 / 策略组 / 内置 policy..."
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

      <div className="max-h-[280px] overflow-auto">
        <Section title="节点" total={candidateNodes.length} filtered={filteredNodes.length}>
          {candidateNodes.length === 0 ? (
            <EmptyHint>
              {hasAnyProvider
                ? "from_providers 未匹配到任何节点 — 可能所选机场未启用 / 尚未拉到节点 / from_providers 选错。可点右上角 ⟳ 刷新节点池"
                : "暂无节点源 — 请先到「节点源」页面添加机场,或在「节点池 → 手动节点」里加几个节点"}
            </EmptyHint>
          ) : filteredNodes.length === 0 ? (
            <EmptyHint>无匹配节点</EmptyHint>
          ) : (
            filteredNodes.map((n) => (
              <CandidateRow
                key={`node-${n.source_provider_id ?? "?"}-${n.name}`}
                name={n.name}
                leadingBadge={n.type}
                trailing={n.source_provider_id}
                disabled={selectedSet.has(n.name)}
                onAdd={() => onAdd(n.name)}
              />
            ))
          )}
        </Section>

        <Section title="策略组" total={candidateGroups.length} filtered={filteredGroups.length}>
          {candidateGroups.length === 0 ? (
            <EmptyHint>暂无其它策略组可引用</EmptyHint>
          ) : filteredGroups.length === 0 ? (
            <EmptyHint>无匹配策略组</EmptyHint>
          ) : (
            filteredGroups.map((g) => (
              <CandidateRow
                key={`group-${g.id}`}
                name={g.name}
                leadingBadge="组"
                trailing={g.id === g.name ? undefined : g.id}
                disabled={selectedSet.has(g.name)}
                onAdd={() => onAdd(g.name)}
              />
            ))
          )}
        </Section>

        <Section title="内置 policy" total={BUILTIN_POLICIES.length} filtered={filteredBuiltins.length}>
          {filteredBuiltins.length === 0 ? (
            <EmptyHint>无匹配内置 policy</EmptyHint>
          ) : (
            filteredBuiltins.map((p) => (
              <CandidateRow
                key={`builtin-${p}`}
                name={p}
                leadingBadge="内置"
                disabled={selectedSet.has(p)}
                onAdd={() => onAdd(p)}
              />
            ))
          )}
        </Section>
      </div>
    </div>
  );
}

function Section({
  title,
  total,
  filtered,
  children,
}: {
  title: string;
  total: number;
  filtered: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-2 px-2 py-1 bg-muted/70 backdrop-blur text-[11px] font-medium text-muted-foreground border-b">
        <span>{title}</span>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5">
          {filtered === total ? total : `${filtered} / ${total}`}
        </Badge>
      </div>
      <div className="divide-y">{children}</div>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return <div className="px-3 py-2 text-xs text-muted-foreground italic leading-relaxed">{children}</div>;
}

function CandidateRow({
  name,
  leadingBadge,
  trailing,
  disabled,
  onAdd,
}: {
  name: string;
  leadingBadge: string;
  trailing?: string;
  disabled?: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 hover:bg-muted/40 text-xs">
      <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 shrink-0">
        {leadingBadge}
      </Badge>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{name}</div>
        {trailing && (
          <div className="text-muted-foreground text-[10px] truncate">{trailing}</div>
        )}
      </div>
      {disabled ? (
        <Badge variant="secondary" className="text-[10px] h-5 px-2 shrink-0">已添加</Badge>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-xs shrink-0"
          onClick={onAdd}
          title="添加到列表末尾"
        >
          <Plus className="h-3 w-3 mr-0.5" />
          添加
        </Button>
      )}
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
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 border rounded-md p-1.5 bg-card">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
        title="拖动调整顺序"
      >
        <GripVertical className="h-4 w-4" />
      </button>
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
        title="从列表移除"
      >
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}
