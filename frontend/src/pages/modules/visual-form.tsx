import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { YamlEditor } from "@/components/yaml-editor";

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
        <Field label="arguments (#!arguments=)">
          <Input
            value={data.arguments ?? ""}
            onChange={(e) => update({ arguments: e.target.value || undefined })}
          />
        </Field>
        <Field label="requirement (#!REQUIREMENT)">
          <Input
            value={data.requirement ?? ""}
            onChange={(e) => update({ requirement: e.target.value || undefined })}
            placeholder="CORE_VERSION>=22"
          />
        </Field>
      </div>

      <div>
        <Label className="text-xs">Content Sections (按段编辑;留空表示该段不输出)</Label>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
