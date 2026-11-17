import { Cloud, FilePen, Puzzle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { AutoGrowTextarea } from "@/components/ui/auto-grow-textarea";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { YamlEditor } from "@/components/yaml-editor";
import { LabeledField, InfoHint, ToggleRow } from "@/components/config-fields";
import { RemoteModuleFields } from "./remote-source";

// 与 backend/src/schemas/surge-module.ts 保持同步
export interface SurgeModuleData {
  id: string;
  name: string;
  description?: string;
  /** local = 在这里按段编辑;remote = 内容来自 url */
  source?: "local" | "remote";
  /** 安装地址允许不带 token 访问;默认 false */
  public?: boolean;
  url?: string;
  fetch_via?: string[];
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

export const LOCAL_SECTION_LABELS: Array<{ key: keyof SurgeModuleData["content_sections"]; label: string }> = [
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
    LOCAL_SECTION_LABELS.find(({ key }) => !!data.content_sections?.[key])?.key ??
    LOCAL_SECTION_LABELS[0].key;
  const source = data.source ?? "local";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Puzzle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>
          Surge 模块 · 可被 Profile 引用(并进 .conf),也可以单独在设备上安装(列表里的「安装到 Surge」)
          <InfoHint>
            并进 Profile 时按 Surge 模块语义合并:[General] / [MITM] 支持 %APPEND% / %INSERT%,规则等行排在
            Profile 原有内容之前,{"{{{参数}}}"} 用 #!arguments 的默认值。仅 Surge 输出生效。
          </InfoHint>
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
        {/* 生成 #!desc= 时换行会被压成空格(backend surge-modules/sgmodule.ts metaValue),所以回车不换行 */}
        <AutoGrowTextarea
          singleParagraph
          value={data.description ?? ""}
          onChange={(e) => update({ description: e.target.value || undefined })}
        />
      </Field>

      <Field label="内容来源">
        <Tabs value={source} onValueChange={(v) => update({ source: v as "local" | "remote" })}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="local" className="gap-1.5 text-xs">
              <FilePen className="h-3.5 w-3.5" />
              在这里编辑
            </TabsTrigger>
            <TabsTrigger value="remote" className="gap-1.5 text-xs">
              <Cloud className="h-3.5 w-3.5" />
              远程 URL
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </Field>

      <ToggleRow
        label="公开安装链接(不需要 token)"
        checked={data.public ?? false}
        onChange={(v) => update({ public: v })}
        description={
          data.public
            ? "任何人知道模块 id 就能读到内容。模块里有密码 / 私有 token(如 external-controller-access)时不要打开。"
            : "安装链接带 ?t=<模块专属 token>,不对就返回 404;Profile 引用不受影响。"
        }
      />

      {source === "remote" ? (
        <RemoteModuleFields data={data} update={update} />
      ) : (
        <LocalModuleFields data={data} update={update} setSection={setSection} defaultTab={defaultTab} />
      )}
    </div>
  );
}

function LocalModuleFields({
  data,
  update,
  setSection,
  defaultTab,
}: Props & {
  setSection: (key: keyof SurgeModuleData["content_sections"], value: string) => void;
  defaultTab: keyof SurgeModuleData["content_sections"];
}) {
  return (
    <>
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
          label="requirement (#!requirement=)"
          hint="模块生效条件,如 CORE_VERSION>=22 或 SYSTEM = 'iOS'(iOS 5.10.0+ / Mac 5.6.0+)。只在设备上安装模块时生效,并进 Profile 时不判断。"
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
          <InfoHint>
            标题带小圆点表示该段已有内容。每段直接写 Surge 模块该章节的原文(模块语法,如 hostname = %APPEND%
            example.com)。
          </InfoHint>
        </Label>
        <Tabs defaultValue={defaultTab} className="mt-2">
          <TabsList className="flex-wrap h-auto">
            {LOCAL_SECTION_LABELS.map(({ key, label }) => {
              const has = !!data.content_sections?.[key];
              return (
                <TabsTrigger key={key} value={key} className="text-xs">
                  {label}
                  {has && <span className="ml-1 h-1.5 w-1.5 rounded-full bg-primary inline-block" />}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {LOCAL_SECTION_LABELS.map(({ key }) => (
            <TabsContent key={key} value={key}>
              <YamlEditor
                value={data.content_sections?.[key] ?? ""}
                onChange={(v) => setSection(key, v)}
                language="ini"
                height={280}
              />
            </TabsContent>
          ))}
        </Tabs>
      </div>
    </>
  );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <LabeledField label={label} hint={hint}>
      {children}
    </LabeledField>
  );
}
