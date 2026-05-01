import { useMemo } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Plus, Trash2, Filter, Flag, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEntityList } from "@/api/entities";
import {
  policyOptionsForGroups,
  makeRuleSetRef,
  makeFinal,
  makeGeoipCn,
} from "./use-profile-form";
import { isFinalRule, isGeoipRule, isRuleSetRef, type Profile, type RuleModuleRef } from "./types";

interface Props {
  draft: Profile;
  onChange: (rules: RuleModuleRef[]) => void;
}

interface RuleSetItem {
  id: string;
  name: string;
}

interface ProxyGroupItem {
  id: string;
  name: string;
}

export function RulePipeline({ draft, onChange }: Props) {
  const rulesetList = useEntityList<RuleSetItem>("rules");
  const groupList = useEntityList<ProxyGroupItem>("groups");

  const policyOptions = useMemo(
    () => policyOptionsForGroups((groupList.data?.items ?? []).map((g) => g.name)),
    [groupList.data],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = useMemo(() => draft.rule_modules.map((r, i) => ({ id: `row-${i}`, idx: i, rule: r })), [draft.rule_modules]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onChange(arrayMove(draft.rule_modules, oldIdx, newIdx));
  };

  const updateRow = (idx: number, rule: RuleModuleRef) => {
    const next = draft.rule_modules.slice();
    next[idx] = rule;
    onChange(next);
  };
  const removeRow = (idx: number) => {
    onChange(draft.rule_modules.filter((_, i) => i !== idx));
  };
  const addRow = (kind: "ruleset" | "final" | "geoip") => {
    const last = policyOptions[0] ?? "DIRECT";
    if (kind === "ruleset") {
      const ref = rulesetList.data?.items[0]?.id ?? "";
      onChange([...draft.rule_modules, makeRuleSetRef(ref, last)]);
    } else if (kind === "final") {
      onChange([...draft.rule_modules, makeFinal(last)]);
    } else {
      onChange([...draft.rule_modules, makeGeoipCn("DIRECT")]);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center gap-2 shrink-0">
        <Filter className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">规则模块流水线</span>
        <span className="text-[11px] text-muted-foreground/70">(从上到下顺序匹配)</span>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-3">
        {draft.rule_modules.length === 0 && (
          <div className="text-center text-xs text-muted-foreground py-8 border border-dashed rounded-md">
            暂无规则,点击下方按钮添加
          </div>
        )}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {items.map(({ id, idx, rule }) => (
                <SortableRow
                  key={id}
                  id={id}
                  idx={idx}
                  rule={rule}
                  rulesetOptions={rulesetList.data?.items ?? []}
                  policyOptions={policyOptions}
                  onUpdate={updateRow}
                  onRemove={removeRow}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </div>

      <div className="border-t p-3 flex flex-wrap gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={() => addRow("ruleset")}>
          <Plus className="h-3.5 w-3.5" />
          规则模块
        </Button>
        <Button size="sm" variant="outline" onClick={() => addRow("geoip")}>
          <Globe className="h-3.5 w-3.5" />
          GeoIP CN
        </Button>
        <Button size="sm" variant="outline" onClick={() => addRow("final")}>
          <Flag className="h-3.5 w-3.5" />
          FINAL
        </Button>
      </div>
    </div>
  );
}

interface RowProps {
  id: string;
  idx: number;
  rule: RuleModuleRef;
  rulesetOptions: RuleSetItem[];
  policyOptions: string[];
  onUpdate: (idx: number, rule: RuleModuleRef) => void;
  onRemove: (idx: number) => void;
}

function SortableRow({ id, idx, rule, rulesetOptions, policyOptions, onUpdate, onRemove }: RowProps) {
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
      className="border rounded-md bg-card flex items-center gap-2 p-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
        title="拖拽排序"
      >
        <GripVertical className="h-4 w-4" />
      </button>

      {isFinalRule(rule) && (
        <>
          <Badge variant="warning" className="text-[10px] uppercase">FINAL</Badge>
          <PolicySelect value={rule.final} options={policyOptions} onChange={(v) => onUpdate(idx, { ...rule, final: v })} />
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap">
            <input
              type="checkbox"
              checked={rule.dns_failed ?? false}
              onChange={(e) => onUpdate(idx, { ...rule, dns_failed: e.target.checked })}
              className="h-3 w-3"
            />
            dns-failed
          </label>
        </>
      )}

      {isGeoipRule(rule) && (
        <>
          <Badge variant="secondary" className="text-[10px]">GEOIP CN</Badge>
          <PolicySelect value={rule.policy} options={policyOptions} onChange={(v) => onUpdate(idx, { ...rule, policy: v })} />
        </>
      )}

      {isRuleSetRef(rule) && (
        <>
          <Badge variant="outline" className="text-[10px]">规则集</Badge>
          <Select value={rule.ref} onValueChange={(v) => onUpdate(idx, { ...rule, ref: v })}>
            <SelectTrigger className="h-7 text-xs flex-1 min-w-0">
              <SelectValue placeholder="选择规则集" />
            </SelectTrigger>
            <SelectContent>
              {rulesetOptions.map((r) => (
                <SelectItem key={r.id} value={r.id} className="text-xs">
                  {r.name}
                </SelectItem>
              ))}
              {rulesetOptions.length === 0 && (
                <div className="px-2 py-1 text-xs text-muted-foreground">暂无规则模块</div>
              )}
            </SelectContent>
          </Select>
          <span className="text-[11px] text-muted-foreground">→</span>
          <PolicySelect value={rule.policy} options={policyOptions} onChange={(v) => onUpdate(idx, { ...rule, policy: v })} />
          <label className="flex items-center gap-1 text-[11px] text-muted-foreground whitespace-nowrap">
            <input
              type="checkbox"
              checked={rule.enabled !== false}
              onChange={(e) => onUpdate(idx, { ...rule, enabled: e.target.checked })}
              className="h-3 w-3"
            />
            启用
          </label>
        </>
      )}

      <Button variant="ghost" size="icon" onClick={() => onRemove(idx)} className="h-7 w-7 shrink-0">
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}

function PolicySelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-7 text-xs w-[140px] shrink-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o} value={o} className="text-xs">
            {o}
          </SelectItem>
        ))}
        {!options.includes(value) && value && (
          <SelectItem value={value} className="text-xs italic text-muted-foreground">
            {value} (自定义)
          </SelectItem>
        )}
      </SelectContent>
    </Select>
  );
}
