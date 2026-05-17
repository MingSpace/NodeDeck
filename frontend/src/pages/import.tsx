import { useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { YamlEditor } from "@/components/yaml-editor";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

interface PreviewResp {
  kind: "surge" | "clash";
  counts: {
    nodes: number;
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
  stats: {
    general: number;
    general_skipped: number;
    /** 包入新 inline Provider 的节点数(单次导入 = 至多 1 个 Provider) */
    nodes: number;
    nodes_skipped: number;
    rules: number;
    rules_skipped: number;
    groups: number;
    groups_skipped: number;
    modules: number;
    modules_skipped: number;
    /** 新创建的 inline Provider 数 (0 或 1) */
    providers: number;
    /** 新建 Provider 的 id 列表 */
    provider_ids: string[];
  };
  warnings: string[];
}

export function ImportPage() {
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"auto" | "surge" | "clash">("auto");
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [opts, setOpts] = useState({
    import_general: true,
    import_nodes: true,
    import_rules: true,
    import_groups: true,
    import_modules: true,
  });

  const previewMutation = useMutation({
    mutationFn: async () =>
      api.post<PreviewResp>("/api/import/preview", {
        text,
        kind: kind === "auto" ? undefined : kind,
        file_name: fileName || undefined,
      }),
    onSuccess: (data) => setPreview(data),
    onError: (err) => toast({ title: "解析失败", description: String(err), variant: "error" }),
  });

  const commitMutation = useMutation({
    mutationFn: async () =>
      api.post<CommitResp>("/api/import/commit", {
        text,
        kind: preview?.kind ?? (kind === "auto" ? undefined : kind),
        file_name: fileName || undefined,
        options: opts,
      }),
    onSuccess: (data) => {
      const totalSkipped =
        data.stats.nodes_skipped +
        data.stats.rules_skipped +
        data.stats.groups_skipped +
        data.stats.modules_skipped +
        data.stats.general_skipped;
      const total =
        data.stats.general +
        data.stats.nodes +
        data.stats.rules +
        data.stats.groups +
        data.stats.modules;
      // 同一份文件二次导入会出现 total=0 / skipped 很多 的"幂等"情况,这里给出更明确的提示。
      const skippedHint = totalSkipped > 0 ? `, 跳过重复 ${totalSkipped} 项(已存在等价条目)` : "";
      toast({
        title: total === 0 && totalSkipped > 0 ? "无新增 (全部为已存在条目)" : "导入完成",
        description: `共导入 ${total} 项: nodes=${data.stats.nodes}(打包为 ${data.stats.providers} 个静态节点源), rules=${data.stats.rules}, groups=${data.stats.groups}, modules=${data.stats.modules}, general=${data.stats.general}${skippedHint}`,
        variant: "success",
      });
      setDetailsOpen(true);
    },
    onError: (err) => toast({ title: "导入失败", description: String(err), variant: "error" }),
  });

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const txt = await file.text();
    setText(txt);
    setFileName(file.name);
    setPreview(null);
    commitMutation.reset();
    e.target.value = "";
  };

  return (
    <div className="p-8 max-w-[1800px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">导入向导</h1>
        <p className="text-muted-foreground mt-1">
          一键从现有 Surge 或 Clash 拆解并导入: 通用预设 / 节点 / 规则 / 策略组 / Surge 模块
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
              <input
                ref={fileInputRef}
                type="file"
                accept=".conf,.yaml,.yml,.txt"
                onChange={onFile}
                className="hidden"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" />
                选择文件
              </Button>
              {fileName && (
                <span
                  className="text-xs text-muted-foreground truncate max-w-[12rem]"
                  title={fileName}
                >
                  {fileName}
                </span>
              )}
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
          <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
            <div className="space-y-1.5">
              <CardTitle>2. 预览与导入</CardTitle>
              <CardDescription>选择导入项,确认后写入 data 目录</CardDescription>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => previewMutation.mutate()}
              disabled={!text || previewMutation.isPending}
            >
              <FileText className="h-4 w-4" />
              {previewMutation.isPending ? "解析中..." : "解析预览"}
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {!preview && (
              <div className="text-sm text-muted-foreground rounded border border-dashed p-6 text-center">
                上传或粘贴左侧内容后,点击右上角「解析预览」
              </div>
            )}
            {preview && (
              <>
                <div className="space-y-1.5 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">检测格式</span>
                    <span className="font-medium uppercase">{preview.kind}</span>
                  </div>
                  <Stat label="通用预设" count={preview.counts.has_general ? 1 : 0} />
                  <Stat label="节点(将打包为静态节点源)" count={preview.counts.nodes} />
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
                  <ToggleRow label="通用预设" checked={opts.import_general} onChange={(v) => setOpts({ ...opts, import_general: v })} disabled={!preview.counts.has_general} />
                  <ToggleRow label="节点(创建为静态节点源)" checked={opts.import_nodes} onChange={(v) => setOpts({ ...opts, import_nodes: v })} disabled={preview.counts.nodes === 0} />
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
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog open={detailsOpen} onOpenChange={setDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              导入详情
            </DialogTitle>
            <DialogDescription>
              本次导入的统计与所有警告信息
            </DialogDescription>
          </DialogHeader>
          {commitMutation.data && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Stat label="通用预设" count={commitMutation.data.stats.general} />
                <Stat label="节点(已打包)" count={commitMutation.data.stats.nodes} />
                <Stat label="新建静态节点源" count={commitMutation.data.stats.providers} />
                <Stat label="规则模块" count={commitMutation.data.stats.rules} />
                <Stat label="策略组" count={commitMutation.data.stats.groups} />
                <Stat label="Surge 模块段" count={commitMutation.data.stats.modules} />
                <SkippedRow label="跳过节点(已在池内)" count={commitMutation.data.stats.nodes_skipped} />
                <SkippedRow label="跳过规则" count={commitMutation.data.stats.rules_skipped} />
                <SkippedRow label="跳过策略组" count={commitMutation.data.stats.groups_skipped} />
                <SkippedRow label="跳过模块" count={commitMutation.data.stats.modules_skipped} />
                <SkippedRow label="跳过通用预设" count={commitMutation.data.stats.general_skipped} />
              </div>
              {commitMutation.data.warnings.length > 0 && (
                <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
                  <div className="text-xs font-medium text-amber-900 mb-2 flex items-center gap-1">
                    <AlertCircle className="h-3.5 w-3.5" />
                    {commitMutation.data.warnings.length} 条警告
                  </div>
                  <ul className="text-xs text-amber-900 list-disc list-inside space-y-1">
                    {commitMutation.data.warnings.map((w, i) => (
                      <li key={i} className="break-words">{w}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
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

// 仅在 count>0 时显示,避免空表格里塞五行 0。
function SkippedRow({ label, count }: { label: string; count: number }) {
  if (count <= 0) return null;
  return (
    <div className="flex items-center justify-between py-0.5 text-amber-700">
      <span>{label}</span>
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
