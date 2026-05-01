import { useState } from "react";
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
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

interface Props {
  proxies: string[];
  onChange: (arr: string[]) => void;
}

export function ProxyListEditor({ proxies, onChange }: Props) {
  const [newName, setNewName] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const items = proxies.map((p, i) => ({ id: `proxy-${i}-${p}`, idx: i, name: p }));

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onChange(arrayMove(proxies, oldIdx, newIdx));
  };

  const add = () => {
    if (!newName.trim()) return;
    onChange([...proxies, newName.trim()]);
    setNewName("");
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="节点名 / 组名 / DIRECT / REJECT"
          className="text-xs"
        />
        <Button size="sm" onClick={add} disabled={!newName.trim()}>
          <Plus className="h-3.5 w-3.5" />
          添加
        </Button>
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
                  onRemove={() => onChange(proxies.filter((_, i) => i !== idx))}
                  onChange={(v) => {
                    const next = proxies.slice();
                    next[idx] = v;
                    onChange(next);
                  }}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableRow({
  id,
  name,
  onRemove,
  onChange,
}: {
  id: string;
  name: string;
  onRemove: () => void;
  onChange: (v: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const isSpecial = name === "DIRECT" || name === "REJECT" || name.startsWith("REJECT-");
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 border rounded-md p-1.5 bg-card">
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {isSpecial && <Badge variant="secondary" className="text-[10px] uppercase">special</Badge>}
      <Input
        value={name}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs h-7 border-0 shadow-none focus-visible:ring-0 px-1"
      />
      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </Button>
    </div>
  );
}
