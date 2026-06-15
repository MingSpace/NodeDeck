import { forwardRef, useEffect, useImperativeHandle, useState } from "react";
import yaml from "js-yaml";
import { YamlEditor } from "@/components/yaml-editor";
import { toast } from "@/components/ui/toast";
import type { Profile } from "./types";

export interface YamlModeHandle {
  save: () => Promise<void>;
}

interface Props {
  draft: Profile;
  onSave: (data: Profile) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
}

export const YamlMode = forwardRef<YamlModeHandle, Props>(function YamlMode(
  { draft, onSave, onDirtyChange },
  ref,
) {
  const [text, setText] = useState("");

  useEffect(() => {
    setText(yaml.dump(draft, { sortKeys: false, lineWidth: 200 }));
    onDirtyChange?.(false);
  }, [draft.id, draft.token]);

  useImperativeHandle(
    ref,
    () => ({
      save: async () => {
        try {
          const parsed = yaml.load(text) as Profile;
          if (!parsed.id) parsed.id = draft.id;
          await onSave(parsed);
          onDirtyChange?.(false);
        } catch (err) {
          toast({ title: "YAML 错误", description: (err as Error).message, variant: "error" });
        }
      },
    }),
    [text, draft.id, onSave, onDirtyChange],
  );

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-3 shrink-0">
        <span className="text-xs font-medium text-muted-foreground">Profile YAML (高级模式)</span>
        <span className="text-[11px] text-muted-foreground/70">直接编辑结构,保存时走 zod 校验</span>
      </div>
      <div className="flex-1 min-h-0">
        <YamlEditor
          value={text}
          onChange={(v) => {
            setText(v);
            onDirtyChange?.(true);
          }}
          height="100%"
        />
      </div>
    </div>
  );
});
