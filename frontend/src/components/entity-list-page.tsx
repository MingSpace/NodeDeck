import { useState } from "react";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useEntityList, useDeleteEntity, type EntityKind } from "@/api/entities";
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
  const [editing, setEditing] = useState<T | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="p-8 max-w-6xl">
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
      {list.data && list.data.items.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">暂无数据</div>
      )}
      {list.data && list.data.items.length > 0 && (
        <Card className="overflow-hidden">
          <div className="divide-y">
            {list.data.items.map((item) => (
              <div key={item.id} className="flex items-center justify-between p-4 hover:bg-muted/30">
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
            ))}
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
