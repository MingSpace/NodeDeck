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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { YamlEditor } from "./yaml-editor";
import { useSaveEntity, type EntityKind } from "@/api/entities";
import { toast } from "@/components/ui/toast";

interface Props<T extends { id: string }> {
  kind: EntityKind;
  entity?: T | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultId?: string;
  templateValue?: Partial<T>;
  title?: string;
  description?: string;
  renderForm: (data: T, update: (patch: Partial<T>) => void, replace: (next: T) => void) => React.ReactNode;
  /** Optional dialog max width class, defaults to sm:max-w-3xl */
  maxWidth?: string;
}

type Mode = "visual" | "yaml";

export function EntityVisualDialog<T extends { id: string }>({
  kind,
  entity,
  open,
  onOpenChange,
  defaultId,
  templateValue,
  title,
  description,
  renderForm,
  maxWidth = "sm:max-w-3xl",
}: Props<T>) {
  const [data, setData] = useState<T | null>(null);
  const [yamlText, setYamlText] = useState("");
  const [mode, setMode] = useState<Mode>("visual");
  const [error, setError] = useState<string | null>(null);
  const save = useSaveEntity<T>(kind);
  // 编辑现有条目时记录原始 id;保存前若发现 id 被改过则拒绝。
  // 这样避免后端按新 id 写文件、留下旧文件,造成 Profile 引用悬空。
  const isEdit = !!entity;
  const originalId = entity?.id ?? null;

  useEffect(() => {
    if (!open) return;
    let initial: T;
    if (entity) {
      initial = JSON.parse(JSON.stringify(entity)) as T;
    } else {
      initial = { id: defaultId ?? "new-id", ...(templateValue ?? {}) } as T;
    }
    setData(initial);
    setYamlText(yaml.dump(initial, { sortKeys: false, lineWidth: 200 }));
    setMode("visual");
    setError(null);
  }, [entity, defaultId, templateValue, open]);

  const update = (patch: Partial<T>) => {
    setData((prev) => (prev ? ({ ...prev, ...patch } as T) : prev));
  };

  const replace = (next: T) => {
    setData(next);
  };

  const switchMode = (next: Mode) => {
    if (mode === "visual" && next === "yaml" && data) {
      setYamlText(yaml.dump(data, { sortKeys: false, lineWidth: 200 }));
    } else if (mode === "yaml" && next === "visual") {
      try {
        const parsed = yaml.load(yamlText) as T;
        if (!parsed || typeof parsed !== "object") {
          setError("YAML 非对象");
          return;
        }
        setData(parsed);
        setError(null);
      } catch (err) {
        setError("YAML 解析失败: " + (err as Error).message);
        return;
      }
    }
    setMode(next);
  };

  const onSave = async () => {
    setError(null);
    let target: T | null = data;
    if (mode === "yaml") {
      try {
        target = yaml.load(yamlText) as T;
      } catch (err) {
        setError("YAML 格式错误: " + (err as Error).message);
        return;
      }
    }
    if (!target || typeof target !== "object" || !("id" in target) || !target.id) {
      setError("缺少 id 字段");
      return;
    }
    if (isEdit && originalId && target.id !== originalId) {
      setError(
        `id 不可修改(原 id:${originalId},现 id:${target.id})。\n` +
          "id 是文件主键,可能被 Profile 等其它实体按 id 引用,直接改会导致引用悬空。\n" +
          "如需重命名,请改 name 字段(不影响引用);如需基于此条目创建新副本,请先关闭对话框,在列表行使用「复制为新条目」按钮。",
      );
      return;
    }
    try {
      await save.mutateAsync(target);
      toast({ title: "已保存", description: `${kind}/${target.id}`, variant: "success" });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${maxWidth} h-[85vh] flex flex-col gap-4`}>
        <DialogHeader>
          <DialogTitle>{title ?? (entity ? `编辑 ${entity.id}` : `新建 ${kind}`)}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <Tabs value={mode} onValueChange={(v) => switchMode(v as Mode)} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="self-start">
            <TabsTrigger value="visual">可视化</TabsTrigger>
            <TabsTrigger value="yaml">YAML 高级</TabsTrigger>
          </TabsList>
          <TabsContent value="visual" className="flex-1 min-h-0 overflow-auto px-1">
            {data && renderForm(data, update, replace)}
          </TabsContent>
          <TabsContent value="yaml" className="flex-1 min-h-0">
            <YamlEditor value={yamlText} onChange={setYamlText} height="100%" />
          </TabsContent>
        </Tabs>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2 whitespace-pre-wrap">
            {error}
          </div>
        )}
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
