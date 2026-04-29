import { useEffect, useState } from "react";
import yaml from "js-yaml";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { YamlEditor } from "./yaml-editor";
import { useSaveEntity, type EntityKind } from "@/api/entities";
import { toast } from "@/components/ui/toast";

interface EntityYamlDialogProps<T extends { id: string }> {
  kind: EntityKind;
  entity?: T | null; // when null, create new
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultId?: string;
  templateValue?: Partial<T>;
  title?: string;
}

export function EntityYamlDialog<T extends { id: string }>({
  kind,
  entity,
  open,
  onOpenChange,
  defaultId,
  templateValue,
  title,
}: EntityYamlDialogProps<T>) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const save = useSaveEntity<T>(kind);

  useEffect(() => {
    if (entity) {
      setText(yaml.dump(entity, { sortKeys: false, lineWidth: 200 }));
    } else if (templateValue) {
      const fresh = { id: defaultId ?? "new-id", ...templateValue };
      setText(yaml.dump(fresh, { sortKeys: false, lineWidth: 200 }));
    } else {
      setText(`id: ${defaultId ?? "new-id"}\nname: New ${kind}\n`);
    }
    setError(null);
  }, [entity, templateValue, defaultId, kind, open]);

  const onSave = async () => {
    setError(null);
    let parsed: T;
    try {
      parsed = yaml.load(text) as T;
    } catch (err) {
      setError("YAML 格式错误: " + (err as Error).message);
      return;
    }
    if (!parsed || typeof parsed !== "object" || !("id" in parsed) || !parsed.id) {
      setError("缺少 id 字段");
      return;
    }
    try {
      await save.mutateAsync(parsed);
      toast({ title: "已保存", description: `${kind}/${parsed.id}`, variant: "success" });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title ?? (entity ? `编辑 ${entity.id}` : `新建 ${kind}`)}</DialogTitle>
          <DialogDescription>使用 YAML 编辑实体定义,保存时按 schema 校验</DialogDescription>
        </DialogHeader>
        <YamlEditor value={text} onChange={setText} height={460} />
        {error && <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2 whitespace-pre-wrap">{error}</div>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onSave} disabled={save.isPending}>
            {save.isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
