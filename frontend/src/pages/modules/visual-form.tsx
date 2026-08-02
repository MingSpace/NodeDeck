import { Puzzle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { YamlEditor } from "@/components/yaml-editor";
import { LabeledField, InfoHint } from "@/components/config-fields";

export interface SurgeModuleData {
  id: string;
  name: string;
  description?: string;
  arguments?: string;
  requirement?: string;
  content_sections: {
    general?: string;
    host?: string;
    ruleset_inline?: string;
    rule?: string;
    url_rewrite?: string;
    header_rewrite?: string;
    body_rewrite?: string;
    script?: string;
    mitm?: string;
  };
}

interface Props {
  data: SurgeModuleData;
  update: (patch: Partial<SurgeModuleData>) => void;
}

const SECTION_LABELS: Array<{ key: keyof SurgeModuleData["content_sections"]; label: string }> = [
  { key: "general", label: "General" },
  { key: "host", label: "Host" },
  { key: "rule", label: "Rule" },
  { key: "ruleset_inline", label: "Ruleset" },
  { key: "url_rewrite", label: "URL Rewrite" },
  { key: "header_rewrite", label: "Header Rewrite" },
  { key: "body_rewrite", label: "Body Rewrite" },
  { key: "script", label: "Script" },
  { key: "mitm", label: "MITM" },
];

export function SurgeModuleVisualForm({ data, update }: Props) {
  const setSection = (key: keyof SurgeModuleData["content_sections"], value: string) => {
    update({
      content_sections: {
        ...data.content_sections,
        [key]: value || undefined,
      },
    });
  };

  const defaultTab =
    SECTION_LABELS.find(({ key }) => !!data.content_sections[key])?.key ??
    SECTION_LABELS[0].key;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Puzzle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Surge 模块 · 打包 General / 规则 / 重写 / 脚本 / MITM 等片段,供 Profile 引用后注入 .conf
          <InfoHint>各段对应 Surge 模块内的 [General] / [Rule] / [URL Rewrite] / [Script] / [MITM] 等章节。仅 Surge 输出生效。</InfoHint>
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ID (文件名)">
          <Input value={data.id} onChange={(e) => update({ id: e.target.value })} />
        </Field>
        <Field label="显示名">
          <Input value={data.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
      </div>

      <Field label="描述">
        <Input
          value={data.description ?? ""}
          onChange={(e) => update({ description: e.target.value || undefined })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field
          label="arguments (#!arguments=)"
          hint="模块可配置参数,对应 #!arguments=。供模块内容里的 {{{arg}}} 占位符引用。"
        >
          <Input
            value={data.arguments ?? ""}
            onChange={(e) => update({ arguments: e.target.value || undefined })}
          />
        </Field>
        <Field
          label="requirement (#!REQUIREMENT)"
          hint="模块生效的最低核心版本要求,对应 #!REQUIREMENT,如 CORE_VERSION>=22。"
        >
          <Input
            value={data.requirement ?? ""}
            onChange={(e) => update({ requirement: e.target.value || undefined })}
            placeholder="CORE_VERSION>=22"
          />
        </Field>
      </div>

      <div>
        <Label className="flex items-center gap-1.5 text-xs">
          Content Sections (按段编辑;留空表示该段不输出)
          <InfoHint>标题带小圆点表示该段已有内容。每段直接写 Surge 模块该章节的原文(INI 风格)。</InfoHint>
        </Label>
        <Tabs defaultValue={defaultTab} className="mt-2">
          <TabsList className="flex-wrap h-auto">
            {SECTION_LABELS.map(({ key, label }) => {
              const has = !!data.content_sections[key];
              return (
                <TabsTrigger key={key} value={key} className="text-xs">
                  {label}
                  {has && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary inline-block" />}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {SECTION_LABELS.map(({ key }) => (
            <TabsContent key={key} value={key}>
              <YamlEditor
                value={data.content_sections[key] ?? ""}
                onChange={(v) => setSection(key, v)}
                language="ini"
                height={280}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <LabeledField label={label} hint={hint}>
      {children}
    </LabeledField>
  );
}
