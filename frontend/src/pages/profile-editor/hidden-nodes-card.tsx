import { ChevronDown, ChevronRight, EyeOff, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChipToggles, SearchMultiSelect, type PickerOption } from "./chain-pickers";
import { SelectorRow } from "./chain-rule-card";
import type { HiddenNodeSelector } from "./types";

interface Props {
  value?: HiddenNodeSelector;
  onChange: (next: HiddenNodeSelector | undefined) => void;
  open: boolean;
  onToggleOpen: () => void;
  hiddenCount?: number;
  hiddenSample?: string[];
  nodeOptions: PickerOption[];
  providerOptions: PickerOption[];
  regionOptions: PickerOption[];
  typeOptions: PickerOption[];
}

/** 与后端 isHiddenSelectorEmpty 同一判定:全空 = 不隐藏任何节点。 */
export function isHiddenSelectorEmpty(sel?: HiddenNodeSelector): boolean {
  if (!sel) return true;
  return (
    !sel.include_regex
    && !sel.exclude_regex
    && (sel.from_providers?.length ?? 0) === 0
    && (sel.include_region?.length ?? 0) === 0
    && (sel.include_type?.length ?? 0) === 0
    && (sel.exclude_type?.length ?? 0) === 0
    && (sel.include_nodes?.length ?? 0) === 0
  );
}

function describe(sel?: HiddenNodeSelector): string {
  if (isHiddenSelectorEmpty(sel)) return "未配置 — 所有节点都可以在客户端里直接选择";
  const parts: string[] = [];
  const nodes = sel!.include_nodes ?? [];
  if (nodes.length > 0) parts.push(nodes.length <= 2 ? `节点 ${nodes.join(" / ")}` : `${nodes.length} 个指定节点`);
  if ((sel!.from_providers ?? []).length > 0) parts.push(`来源 ${sel!.from_providers!.join(" / ")}`);
  if ((sel!.include_region ?? []).length > 0) parts.push(`地区 ${sel!.include_region!.join(" / ")}`);
  if ((sel!.include_type ?? []).length > 0) parts.push(`仅 ${sel!.include_type!.join(" / ")}`);
  if ((sel!.exclude_type ?? []).length > 0) parts.push(`排除 ${sel!.exclude_type!.join(" / ")}`);
  if (sel!.include_regex) parts.push(`名称含 /${sel!.include_regex}/`);
  if (sel!.exclude_regex) parts.push(`名称不含 /${sel!.exclude_regex}/`);
  return parts.join(" · ");
}

/**
 * 「仅作链式落地」的节点隐藏配置。
 *
 * 用途:落地节点(或跳板节点)照常出现在订阅的节点段里 —— 客户端能把它当链式出口用,
 * 也能被某个策略组的成员清单显式点名 —— 但不再被任何组的自动筛选(地区组 / 自动测速组)
 * 收纳,于是不会在客户端的选择列表里以"直连它"的形式出现。
 */
export function HiddenNodesCard({
  value,
  onChange,
  open,
  onToggleOpen,
  hiddenCount,
  hiddenSample,
  nodeOptions,
  providerOptions,
  regionOptions,
  typeOptions,
}: Props) {
  const sel = value ?? {};
  const empty = isHiddenSelectorEmpty(value);

  const patch = (p: Partial<HiddenNodeSelector>) => {
    const next = { ...sel, ...p };
    // 条件被清空后直接把整个字段去掉,避免 yaml 里留一段空选择器
    onChange(isHiddenSelectorEmpty(next) ? undefined : next);
  };

  return (
    <div className="rounded-lg border bg-card">
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/40"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <EyeOff className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="shrink-0 text-xs font-medium">仅作链式落地的节点</span>
        {!empty && hiddenCount !== undefined && (
          <span
            className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums"
            title="命中的节点数量"
          >
            {hiddenCount}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-normal text-muted-foreground" title={describe(value)}>
          {describe(value)}
        </span>
      </button>

      {open && (
        <div className="space-y-3 border-t px-3 py-3">
          <div className="flex gap-2 rounded-md bg-muted/40 px-2.5 py-2 text-[11px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div>
              命中的节点仍会写进订阅的节点段,所以能被上面的规则当作链式出口、也能被策略组的成员清单
              <span className="text-foreground">显式点名</span>
              (你就是靠这种组来使用链式落地的);但它们不会再被策略组的自动筛选(地区组、测速组)收纳,
              客户端的选择列表里也就看不到"直连它"这个选项。
            </div>
          </div>

          <SelectorRow label="指定节点" hint="点名要隐藏的落地节点">
            <SearchMultiSelect
              options={nodeOptions}
              selected={sel.include_nodes ?? []}
              onChange={(v) => patch({ include_nodes: v })}
              emptyLabel="未点名具体节点"
              addLabel="选择节点"
              searchPlaceholder="搜索节点名…"
              noOptionsHint="节点池为空 — 先在「节点来源」选机场"
            />
          </SelectorRow>

          <SelectorRow label="节点来源" hint="整个机场都只作落地时用这个">
            <SearchMultiSelect
              options={providerOptions}
              selected={sel.from_providers ?? []}
              onChange={(v) => patch({ from_providers: v })}
              emptyLabel="不按机场限定"
              addLabel="选择机场"
              searchPlaceholder="搜索机场…"
              noOptionsHint="暂无节点源"
            />
          </SelectorRow>

          <SelectorRow label="地区" hint="与其它条件是「且」">
            <ChipToggles
              options={regionOptions}
              selected={sel.include_region ?? []}
              onChange={(v) => patch({ include_region: v })}
              emptyLabel="当前节点池没有可识别地区的节点"
            />
          </SelectorRow>

          <SelectorRow label="协议">
            <div className="space-y-1.5">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-8 shrink-0 text-[11px] text-muted-foreground">仅</span>
                <div className="min-w-0 flex-1">
                  <ChipToggles
                    options={typeOptions}
                    selected={sel.include_type ?? []}
                    onChange={(v) => patch({ include_type: v })}
                    emptyLabel="不限协议"
                  />
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-8 shrink-0 text-[11px] text-muted-foreground">排除</span>
                <div className="min-w-0 flex-1">
                  <ChipToggles
                    options={typeOptions}
                    selected={sel.exclude_type ?? []}
                    onChange={(v) => patch({ exclude_type: v })}
                    emptyLabel="不排除"
                    tone="destructive"
                  />
                </div>
              </div>
            </div>
          </SelectorRow>

          <SelectorRow label="名称正则" hint="默认大小写不敏感,不要写 (?i)">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                value={sel.include_regex ?? ""}
                onChange={(e) => patch({ include_regex: e.target.value || undefined })}
                placeholder="包含:落地|家宽|IEPL"
                className="h-7 font-mono text-xs"
              />
              <Input
                value={sel.exclude_regex ?? ""}
                onChange={(e) => patch({ exclude_regex: e.target.value || undefined })}
                placeholder="排除:测试"
                className="h-7 font-mono text-xs"
              />
            </div>
          </SelectorRow>

          {!empty && (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                {hiddenSample && hiddenSample.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {hiddenSample.map((name) => (
                      <span
                        key={name}
                        className="max-w-[200px] truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]"
                        title={name}
                      >
                        {name}
                      </span>
                    ))}
                    {hiddenCount !== undefined && hiddenCount > hiddenSample.length && (
                      <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
                        …另外 {hiddenCount - hiddenSample.length} 个
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-[11px] text-amber-700 dark:text-amber-400">
                    当前条件没有命中任何节点
                  </span>
                )}
              </div>
              <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2" onClick={() => onChange(undefined)}>
                <X className="h-3 w-3" />
                清空
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
