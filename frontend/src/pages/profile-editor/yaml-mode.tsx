import { useEffect, useState } from "react";
import yaml from "js-yaml";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { YamlEditor } from "@/components/yaml-editor";
import { toast } from "@/components/ui/toast";
import type { Profile } from "./types";

interface Props {
  draft: Profile;
  onSave: (data: Profile) => Promise<void>;
  saving: boolean;
}

export function YamlMode({ draft, onSave, saving }: Props) {
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setText(yaml.dump(draft, { sortKeys: false, lineWidth: 200 }));
    setDirty(false);
  }, [draft.id, draft.token]);

  const handleSave = async () => {
    try {
      const parsed = yaml.load(text) as Profile;
      if (!parsed.id) parsed.id = draft.id;
      await onSave(parsed);
      setDirty(false);
    } catch (err) {
      toast({ title: "YAML 错误", description: (err as Error).message, variant: "error" });
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-3 shrink-0">
        <span className="text-xs font-medium text-muted-foreground">Profile YAML (高级模式)</span>
        <span className="text-[11px] text-muted-foreground/70">直接编辑结构,保存时走 zod 校验</span>
        <div className="flex-1" />
        <Button size="sm" onClick={handleSave} disabled={!dirty || saving}>
          <Save className="h-3.5 w-3.5" />
          {saving ? "保存中..." : "保存"}
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        <YamlEditor
          value={text}
          onChange={(v) => {
            setText(v);
            setDirty(true);
          }}
          height="100%"
        />
      </div>
    </div>
  );
}
