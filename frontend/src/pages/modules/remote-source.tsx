import { CircleCheck, CircleX, CloudDownload, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { YamlEditor } from "@/components/yaml-editor";
import { LabeledField } from "@/components/config-fields";
import { formatBytes } from "@/lib/utils";
import { FetchRoutesEditor } from "@/pages/providers/fetch-via";
import { useModuleTestFetch } from "./api";
import type { SurgeModuleData } from "./visual-form";

interface Props {
  data: SurgeModuleData;
  update: (patch: Partial<SurgeModuleData>) => void;
}

/** 远程模块:只填上游 .sgmodule 地址与拉取线路;内容以上游为准,这里只读预览。 */
export function RemoteModuleFields({ data, update }: Props) {
  const test = useModuleTestFetch();
  const url = data.url?.trim() ?? "";
  const fetchVia = data.fetch_via ?? [];
  // 结果对应的输入和当前输入不一致时提示「已改动」
  const tested = test.variables;
  const outdated = !!tested && (tested.url !== url || tested.fetch_via.join(",") !== fetchVia.join(","));
  const result = test.data;

  return (
    <div className="space-y-4">
      <LabeledField
        label="模块地址"
        hint="上游 .sgmodule 的直链(GitHub 请用 Raw 地址)。NodeDeck 缓存 5 分钟,过期后在被用到时重新拉取;想立刻生效就在列表里点刷新。"
      >
        <Input
          value={data.url ?? ""}
          onChange={(e) => update({ url: e.target.value || undefined })}
          placeholder="https://raw.githubusercontent.com/you/repo/main/example.sgmodule"
          className="font-mono text-xs"
        />
      </LabeledField>

      <div>
        <Label className="text-xs">拉取线路</Label>
        <FetchRoutesEditor value={fetchVia} onChange={(next) => update({ fetch_via: next })} />
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          服务器连不上上游(如 GitHub)时,借出口机的网络拉。从上往下试,前一条失败才换下一条。
        </p>
      </div>

      <div className="rounded-md border">
        <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2">
          <span className="text-xs font-medium">内容预览</span>
          {result && !outdated && (
            <span className="truncate text-xs text-muted-foreground">
              {result.ok
                ? `${result.name ?? "未命名"} · ${formatBytes(result.bytes ?? 0)} · ${result.duration_ms} ms`
                : `${result.duration_ms} ms`}
            </span>
          )}
          {outdated && <span className="text-xs text-amber-600 dark:text-amber-400">地址或线路已改动,重新拉取看看</span>}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="ml-auto h-7"
            disabled={!url || test.isPending}
            onClick={() => test.mutate({ url, fetch_via: fetchVia })}
          >
            {test.isPending ? (
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <CloudDownload className="h-3.5 w-3.5" />
            )}
            拉取预览
          </Button>
        </div>
        <div className="p-3">
          {!result && !test.isError && (
            <p className="text-xs text-muted-foreground">
              点「拉取预览」确认地址可用;保存后 Profile 引用与设备安装都用这份上游内容。
            </p>
          )}
          {test.isError && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {test.error instanceof Error ? test.error.message : String(test.error)}
            </p>
          )}
          {result && !result.ok && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <CircleX className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="break-all">{result.error}</span>
            </p>
          )}
          {result?.ok && (
            <div className="space-y-2">
              <div className="flex items-start gap-1.5 text-xs">
                <CircleCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <div className="min-w-0 space-y-1">
                  {result.desc && <p className="text-muted-foreground">{result.desc}</p>}
                  <div className="flex flex-wrap gap-1">
                    {(result.sections ?? []).map((s) => (
                      <span key={s.name} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                        [{s.name}] {s.lines}
                      </span>
                    ))}
                  </div>
                  {result.arguments && (
                    <p className="font-mono text-[11px] text-muted-foreground">#!arguments={result.arguments}</p>
                  )}
                </div>
              </div>
              <YamlEditor value={result.text ?? ""} onChange={() => undefined} language="ini" height={240} readOnly />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
