import { useMemo, useState } from "react";
import { Plus, Edit, Trash2, X, Loader2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  useEntityList,
  useDeleteEntity,
  useDeleteEntitiesBulk,
  useSaveEntity,
  type EntityKind,
} from "@/api/entities";
import { EntityYamlDialog } from "./entity-yaml-dialog";
import { toast } from "@/components/ui/toast";

interface EntityListPageProps<T extends { id: string }> {
  title: string;
  description?: string;
  kind: EntityKind;
  /** Render extra columns per row */
  renderRow?: (item: T) => React.ReactNode;
  template?: Partial<T>;
  /** Optional custom create dialog (e.g. Providers uses a richer form); falls back to YAML dialog if absent */
  CustomCreateButton?: React.ComponentType;
  /** Optional custom dialog renderer (replaces default YAML dialog) */
  renderDialog?: (props: {
    entity: T | null;
    open: boolean;
    onOpenChange: (v: boolean) => void;
    defaultId: string;
  }) => React.ReactNode;
}

export function EntityListPage<T extends { id: string; name?: string }>({
  title,
  description,
  kind,
  renderRow,
  template,
  CustomCreateButton,
  renderDialog,
}: EntityListPageProps<T>) {
  const list = useEntityList<T>(kind);
  const del = useDeleteEntity(kind);
  const bulkDel = useDeleteEntitiesBulk(kind);
  const save = useSaveEntity<T>(kind);
  const [editing, setEditing] = useState<T | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const items = list.data?.items ?? [];

  // 在现有 id 集合里找一个唯一的副本 id:`<src>-copy`、`<src>-copy-2`、`<src>-copy-3` ...
  // 不依赖后端,纯前端兜底;真正的唯一性由后端 PUT (写入磁盘) 保证。
  const ensureUniqueId = (sourceId: string): string => {
    const ids = new Set(items.map((it) => it.id));
    const base = `${sourceId}-copy`;
    if (!ids.has(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const candidate = `${base}-${i}`;
      if (!ids.has(candidate)) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  };

  const handleDuplicate = async (item: T) => {
    setDuplicatingId(item.id);
    try {
      const newId = ensureUniqueId(item.id);
      // 深拷贝原条目,改写 id;若有 name 字段则追加「(副本)」后缀以便在列表里一眼区分。
      // 其它字段(包括引用类字段)按原样复制 — 这是方案 B 的本意:复制不连带迁移其它实体的引用。
      const cloned = JSON.parse(JSON.stringify(item)) as T & { name?: string };
      cloned.id = newId;
      if (typeof cloned.name === "string" && cloned.name.length > 0) {
        cloned.name = `${cloned.name} (副本)`;
      }
      await save.mutateAsync(cloned as T);
      toast({
        title: "已复制为新条目",
        description: `${kind}/${newId}`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "复制失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setDuplicatingId(null);
    }
  };

  // 当列表数据刷新后,清理掉已被删除的 id;否则切换实体后"已选数量"会包含幽灵 id。
  const validSelected = useMemo(() => {
    if (selected.size === 0) return selected;
    const ids = new Set(items.map((it) => it.id));
    const next = new Set<string>();
    selected.forEach((id) => {
      if (ids.has(id)) next.add(id);
    });
    return next;
  }, [items, selected]);

  const allSelected = items.length > 0 && validSelected.size === items.length;
  const partialSelected = validSelected.size > 0 && !allSelected;
  const hasSelection = validSelected.size > 0;

  const toggleOne = (id: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAll = (checked: boolean) => {
    if (checked) setSelected(new Set(items.map((it) => it.id)));
    else setSelected(new Set());
  };

  const clearSelection = () => setSelected(new Set());

  const handleBulkDelete = async () => {
    const ids = Array.from(validSelected);
    if (ids.length === 0) return;
    if (!window.confirm(`确认删除选中的 ${ids.length} 项?此操作不可撤销。`)) return;
    try {
      const res = await bulkDel.mutateAsync(ids);
      if (res.failed.length === 0) {
        toast({ title: `已删除 ${res.succeeded.length} 项`, variant: "success" });
      } else if (res.succeeded.length === 0) {
        toast({
          title: "批量删除失败",
          description: res.failed.slice(0, 3).map((f) => `${f.id}: ${f.error}`).join("; "),
          variant: "error",
        });
      } else {
        toast({
          title: `成功 ${res.succeeded.length} · 失败 ${res.failed.length}`,
          description: res.failed.slice(0, 3).map((f) => `${f.id}: ${f.error}`).join("; "),
          variant: "error",
        });
      }
      clearSelection();
    } catch (err) {
      toast({ title: "批量删除失败", description: String(err), variant: "error" });
    }
  };

  return (
    <div className="p-8 max-w-[1800px] mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {description && <p className="text-muted-foreground mt-1">{description}</p>}
        </div>
        {CustomCreateButton ? (
          <CustomCreateButton />
        ) : (
          <Button
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            新建
          </Button>
        )}
      </div>

      {list.isLoading && <div className="text-muted-foreground text-sm">加载中...</div>}
      {list.error && <div className="text-destructive text-sm">加载失败: {String(list.error)}</div>}
      {list.data && items.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">暂无数据</div>
      )}
      {list.data && items.length > 0 && (
        <Card className="overflow-hidden">
          {/* 表头:全选 + 选中数 + 批量操作。选中时切换为高亮"已选"工具条。 */}
          <div
            className={`flex items-center gap-3 px-4 py-2.5 border-b text-xs transition-colors ${
              hasSelection ? "bg-primary/5" : "bg-muted/30"
            }`}
          >
            <Checkbox
              checked={allSelected ? true : partialSelected ? "indeterminate" : false}
              onCheckedChange={(v) => toggleAll(v === true)}
              aria-label="全选"
            />
            {hasSelection ? (
              <>
                <span className="font-medium text-foreground">
                  已选 {validSelected.size} / {items.length} 项
                </span>
                <div className="ml-auto flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                    disabled={bulkDel.isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                    取消选择
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleBulkDelete}
                    disabled={bulkDel.isPending}
                  >
                    {bulkDel.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="h-3.5 w-3.5" />
                    )}
                    批量删除
                  </Button>
                </div>
              </>
            ) : (
              <span className="text-muted-foreground">共 {items.length} 项,勾选以批量操作</span>
            )}
          </div>
          <div className="divide-y">
            {items.map((item) => {
              const checked = validSelected.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 p-4 transition-colors ${
                    checked ? "bg-primary/5 hover:bg-primary/10" : "hover:bg-muted/30"
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(v) => toggleOne(item.id, v === true)}
                    aria-label={`选择 ${item.name ?? item.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{item.name ?? item.id}</div>
                    <div className="text-xs text-muted-foreground truncate">{item.id}</div>
                    {renderRow && <div className="text-xs text-muted-foreground mt-1">{renderRow(item)}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditing(item);
                        setDialogOpen(true);
                      }}
                      title="编辑"
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDuplicate(item)}
                      disabled={duplicatingId === item.id}
                      title="复制为新条目(原 id 不变,新条目 id 为 <原 id>-copy)"
                    >
                      {duplicatingId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={async () => {
                        if (!window.confirm(`删除 ${item.name ?? item.id}?`)) return;
                        try {
                          await del.mutateAsync(item.id);
                          toast({ title: "已删除", variant: "success" });
                        } catch (err) {
                          toast({ title: "删除失败", description: String(err), variant: "error" });
                        }
                      }}
                      title="删除"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {renderDialog ? (
        renderDialog({
          entity: editing,
          open: dialogOpen,
          onOpenChange: setDialogOpen,
          defaultId: editing?.id ?? `${kind.slice(0, -1)}-${Date.now().toString(36)}`,
        })
      ) : (
        <EntityYamlDialog<T>
          kind={kind}
          entity={editing}
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          templateValue={template}
          defaultId={editing?.id ?? `${kind.slice(0, -1)}-${Date.now().toString(36)}`}
        />
      )}
    </div>
  );
}
