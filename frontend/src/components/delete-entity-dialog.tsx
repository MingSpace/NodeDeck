import { useMemo } from "react";
import { AlertTriangle, Loader2, Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useEntityReferences, type EntityKind, type EntityReference } from "@/api/entities";

const KIND_LABELS: Record<EntityReference["from_kind"], string> = {
  profiles: "Profile",
  groups: "策略组",
  generals: "全局配置",
  rules: "规则集",
  notification: "通知设置",
};

export interface DeleteTarget {
  id: string;
  name?: string;
}

interface DeleteEntityDialogProps {
  kind: EntityKind;
  /** 待删除条目;单删传一项,批删传多项 */
  targets: DeleteTarget[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 用户确认后回调,只带回没有被引用、可以安全删除的 id */
  onConfirm: (ids: string[]) => void;
  /** 删除请求进行中 */
  busy?: boolean;
}

/**
 * 删除确认弹窗。打开时先查引用:被别的实体引用的条目不允许删除(删了只会在
 * 引用方留下悬空引用,客户端加载订阅时报 policy not found),弹窗把引用位置
 * 逐条列出来,用户解除引用后再回来删。
 */
export function DeleteEntityDialog({
  kind,
  targets,
  open,
  onOpenChange,
  onConfirm,
  busy = false,
}: DeleteEntityDialogProps) {
  const ids = useMemo(() => targets.map((t) => t.id), [targets]);
  const refs = useEntityReferences(kind, ids, open);

  const { blocked, deletable } = useMemo(() => {
    const map = refs.data ?? {};
    const blocked: { target: DeleteTarget; references: EntityReference[] }[] = [];
    const deletable: DeleteTarget[] = [];
    for (const target of targets) {
      const blocking = (map[target.id] ?? []).filter((r) => r.blocking);
      if (blocking.length > 0) blocked.push({ target, references: blocking });
      else deletable.push(target);
    }
    return { blocked, deletable };
  }, [refs.data, targets]);

  const checking = refs.isPending && ids.length > 0;
  const label = (t: DeleteTarget) => t.name ?? t.id;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {blocked.length > 0 && deletable.length === 0
              ? "无法删除"
              : targets.length === 1
                ? `删除 ${label(targets[0])}`
                : `删除 ${targets.length} 项`}
          </DialogTitle>
          <DialogDescription>
            {checking
              ? "正在检查引用..."
              : blocked.length > 0
                ? "被其它配置引用的条目不能删除,请先到引用位置解除引用。"
                : "此操作不可撤销。"}
          </DialogDescription>
        </DialogHeader>

        {refs.error && (
          <p className="text-sm text-destructive">
            引用检查失败: {refs.error instanceof Error ? refs.error.message : String(refs.error)}
          </p>
        )}

        {checking && (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            检查引用中
          </div>
        )}

        {!checking && blocked.length > 0 && (
          <div className="max-h-[45vh] space-y-3 overflow-y-auto">
            {blocked.map(({ target, references }) => (
              <div key={target.id} className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-destructive" />
                  <span className="truncate">{label(target)}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {references.length} 处引用
                  </span>
                </div>
                <ul className="mt-2 space-y-1">
                  {references.map((r, i) => (
                    <li
                      key={`${r.from_kind}-${r.from_id}-${r.field}-${i}`}
                      className="flex items-start gap-2 text-xs text-muted-foreground"
                    >
                      <Link2 className="mt-0.5 h-3 w-3 shrink-0" />
                      <span>
                        {KIND_LABELS[r.from_kind]}
                        <span className="text-foreground">「{r.from_name}」</span>
                        <span className="mx-1">·</span>
                        <code className="rounded bg-muted px-1 py-0.5 font-mono">{r.field}</code>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}

        {!checking && blocked.length > 0 && deletable.length > 0 && (
          <p className="text-sm text-muted-foreground">
            其余 {deletable.length} 项没有被引用,可以直接删除。
          </p>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {deletable.length === 0 ? "关闭" : "取消"}
          </Button>
          {deletable.length > 0 && (
            <Button
              variant="destructive"
              disabled={checking || busy}
              onClick={() => onConfirm(deletable.map((t) => t.id))}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {blocked.length > 0 ? `删除其余 ${deletable.length} 项` : "删除"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
