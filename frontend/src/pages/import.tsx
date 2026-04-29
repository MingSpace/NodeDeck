import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { YamlEditor } from "@/components/yaml-editor";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

interface PreviewResp {
  kind: "surge" | "clash";
  counts: {
    manual_nodes: number;
    rule_sets: number;
    proxy_groups: number;
    modules: number;
    has_general: boolean;
  };
  sample: { first_node?: unknown; first_ruleset?: unknown; first_group?: unknown };
  warnings: string[];
}

interface CommitResp {
  ok: boolean;
  stats: { general: number; manual_nodes: number; rules: number; groups: number; modules: number };
  warnings: string[];
}

export function ImportPage() {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"auto" | "surge" | "clash">("auto");
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [opts, setOpts] = useState({
    import_general: true,
    import_nodes: true,
    import_rules: true,
    import_groups: true,
    import_modules: true,
  });

  const previewMutation = useMutation({
    mutationFn: async () =>
      api.post<PreviewResp>("/api/import/preview", { text, kind: kind === "auto" ? undefined : kind }),
    onSuccess: (data) => setPreview(data),
    onError: (err) => toast({ title: "解析失败", description: String(err), variant: "error" }),
  });

  const commitMutation = useMutation({
    mutationFn: async () =>
      api.post<CommitResp>("/api/import/commit", {
        text,
        kind: preview?.kind ?? (kind === "auto" ? undefined : kind),
        options: opts,
      }),
    onSuccess: (data) => {
      const total = Object.values(data.stats).reduce((a, b) => a + b, 0);
      toast({
        title: "导入完成",
        description: `共导入 ${total} 项: nodes=${data.stats.manual_nodes}, rules=${data.stats.rules}, groups=${data.stats.groups}, modules=${data.stats.modules}, general=${data.stats.general}`,
        variant: "success",
      });
    },
    onError: (err) => toast({ title: "导入失败", description: String(err), variant: "error" }),
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const txt = await file.text();
    setText(txt);
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">导入向导</h1>
        <p className="text-muted-foreground mt-1">
          一键从现有 Surge .conf 或 Clash YAML 拆解并导入: General / 节点 / 规则 / 策略组 / Surge 模块
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>1. 上传或粘贴配置</CardTitle>
            <CardDescription>支持 Surge .conf 或 Clash YAML</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <input type="file" accept=".conf,.yaml,.yml,.txt" onChange={onFile} className="text-sm" />
              <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">自动检测</SelectItem>
                  <SelectItem value="surge">Surge</SelectItem>
                  <SelectItem value="clash">Clash</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={() => previewMutation.mutate()}
                disabled={!text || previewMutation.isPending}
              >
                <FileText className="h-4 w-4" />
                解析预览
              </Button>
            </div>
            <YamlEditor
              value={text}
              onChange={setText}
              language={kind === "surge" ? "ini" : "yaml"}
              height={460}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>2. 预览与导入</CardTitle>
            <CardDescription>选择导入项,确认后写入 data 目录</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!preview && (
              <div className="text-sm text-muted-foreground rounded border border-dashed p-6 text-center">
                上传/粘贴后点击「解析预览」
              </div>
            )}
            {preview && (
              <>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">检测格式</span>
                    <span className="font-medium uppercase">{preview.kind}</span>
                  </div>
                  <Stat label="General 预设" count={preview.counts.has_general ? 1 : 0} />
                  <Stat label="节点 (manual-nodes)" count={preview.counts.manual_nodes} />
                  <Stat label="规则模块 (RuleSet URL)" count={preview.counts.rule_sets} />
                  <Stat label="策略组" count={preview.counts.proxy_groups} />
                  <Stat label="Surge 模块段" count={preview.counts.modules} />
                </div>

                {preview.warnings.length > 0 && (
                  <Card className="bg-amber-50 border-amber-200">
                    <CardContent className="p-3 text-xs text-amber-900">
                      <div className="font-medium mb-1 flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5" /> {preview.warnings.length} 条警告
                      </div>
                      <ul className="list-disc list-inside space-y-0.5">
                        {preview.warnings.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">勾选要导入的部分</Label>
                  <ToggleRow label="General 预设" checked={opts.import_general} onChange={(v) => setOpts({ ...opts, import_general: v })} disabled={!preview.counts.has_general} />
                  <ToggleRow label="节点(追加到 manual-nodes)" checked={opts.import_nodes} onChange={(v) => setOpts({ ...opts, import_nodes: v })} disabled={preview.counts.manual_nodes === 0} />
                  <ToggleRow label="规则模块" checked={opts.import_rules} onChange={(v) => setOpts({ ...opts, import_rules: v })} disabled={preview.counts.rule_sets === 0} />
                  <ToggleRow label="策略组" checked={opts.import_groups} onChange={(v) => setOpts({ ...opts, import_groups: v })} disabled={preview.counts.proxy_groups === 0} />
                  {preview.kind === "surge" && (
                    <ToggleRow label="Surge 模块段" checked={opts.import_modules} onChange={(v) => setOpts({ ...opts, import_modules: v })} disabled={preview.counts.modules === 0} />
                  )}
                </div>

                <Button onClick={() => commitMutation.mutate()} disabled={commitMutation.isPending} className="w-full">
                  <Upload className="h-4 w-4" />
                  {commitMutation.isPending ? "导入中..." : "确认导入"}
                </Button>

                {commitMutation.data && (
                  <div className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-900 flex items-start gap-2">
                    <CheckCircle2 className="h-4 w-4 mt-0.5" />
                    <div>
                      <div className="font-medium">导入完成</div>
                      <div className="text-xs mt-1">
                        nodes={commitMutation.data.stats.manual_nodes} · rules={commitMutation.data.stats.rules} · groups={commitMutation.data.stats.groups} · modules={commitMutation.data.stats.modules} · general={commitMutation.data.stats.general}
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{count}</span>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between py-1 ${disabled ? "opacity-40" : ""}`}>
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
