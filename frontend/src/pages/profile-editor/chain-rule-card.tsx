import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownRight,
  GripVertical,
  Layers,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { ChipToggles, SearchMultiSelect, SearchSingleSelect, type PickerOption } from "./chain-pickers";
import type { ChainRule, ChainRuleStat, ChainSelector } from "./types";

export interface ChainRuleCardProps {
  sortableId: string;
  index: number;
  rule: ChainRule;
  stat?: ChainRuleStat;
  expanded: boolean;
  onToggleExpanded: () => void;
  onUpdate: (patch: Partial<ChainRule>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  viaOptions: PickerOption[];
  groupOptions: PickerOption[];
  nodeOptions: PickerOption[];
  providerOptions: PickerOption[];
  regionOptions: PickerOption[];
  typeOptions: PickerOption[];
}

const VIA_STATUS_LABEL: Record<ChainRuleStat["via_status"], string> = {
  node: "节点",
  group: "策略组",
  builtin: "内置策略",
  missing: "未找到",
};

/** 折叠态摘要:让用户不展开也能看懂这条规则圈的是谁。 */
function describeScope(selector: ChainSelector): string {
  const parts: string[] = [];
  const groups = selector.include_groups ?? [];
  const nodes = selector.include_nodes ?? [];
  if (groups.length > 0) parts.push(`组 ${groups.join(" / ")}`);
  if (nodes.length > 0) {
    parts.push(nodes.length <= 2 ? `节点 ${nodes.join(" / ")}` : `${nodes.length} 个指定节点`);
  }
  if ((selector.from_providers ?? []).length > 0) {
    parts.push(`来源 ${selector.from_providers!.join(" / ")}`);
  }
  if ((selector.include_region ?? []).length > 0) {
    parts.push(`地区 ${selector.include_region!.join(" / ")}`);
  }
  if ((selector.include_type ?? []).length > 0) parts.push(`仅 ${selector.include_type!.join(" / ")}`);
  if ((selector.exclude_type ?? []).length > 0) parts.push(`排除 ${selector.exclude_type!.join(" / ")}`);
  if (selector.include_regex) parts.push(`名称含 /${selector.include_regex}/`);
  if (selector.exclude_regex) parts.push(`名称不含 /${selector.exclude_regex}/`);
  return parts.length === 0 ? "全部节点" : parts.join(" · ");
}

export function ChainRuleCard({
  sortableId,
  index,
  rule,
  stat,
  expanded,
  onToggleExpanded,
  onUpdate,
  onRemove,
  onDuplicate,
  viaOptions,
  groupOptions,
  nodeOptions,
  providerOptions,
  regionOptions,
  typeOptions,
}: ChainRuleCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
  });
  const enabled = rule.enabled !== false;
  const selector = rule.selector ?? {};
  // 出口为空的规则后端会拒绝保存(via 必填),命中预览也拿不到 —— 卡片上直接说清楚。
  const incomplete = rule.via.trim().length === 0;
  // 命中了节点却一个都没生效 = 全部被更靠前的规则抢走,这条规则实际是死的。
  const shadowed =
    !!stat && stat.enabled && stat.matched_count > 0 && stat.effective_count === 0 && stat.kept_existing_count === 0;

  const patchSelector = (patch: Partial<ChainSelector>) =>
    onUpdate({ selector: { ...selector, ...patch } });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 }}
      className={cn(
        "rounded-lg border bg-card transition-colors",
        !enabled && "border-dashed bg-muted/30",
      )}
    >
      <div className="flex items-center gap-1.5 px-2 py-2">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="shrink-0 cursor-grab touch-none text-muted-foreground/70 transition-colors hover:text-foreground active:cursor-grabbing"
          title="拖拽调整优先级"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <span className="w-5 shrink-0 text-center text-[11px] font-medium tabular-nums text-muted-foreground">
          {index + 1}
        </span>
        <button
          type="button"
          onClick={onToggleExpanded}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={expanded ? "收起" : "展开"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className={cn("shrink-0 text-[11px]", enabled ? "text-muted-foreground" : "text-muted-foreground/60")}>
              经由
            </span>
            <SearchSingleSelect
              value={rule.via}
              options={viaOptions}
              onChange={(v) => onUpdate({ via: v })}
              placeholder="选择出口节点 / 策略组"
              tone={incomplete || stat?.via_status === "missing" ? "warning" : "default"}
            />
            {incomplete ? (
              <span className="shrink-0 text-[10px] text-amber-700 dark:text-amber-400">
                未选择出口,保存会被拒绝
              </span>
            ) : (
              stat && (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {VIA_STATUS_LABEL[stat.via_status]}
                </span>
              )
            )}
          </div>
          <div className="min-w-0 truncate text-[11px] text-muted-foreground" title={describeScope(selector)}>
            {rule.comment ? <span className="text-foreground">{rule.comment} — </span> : null}
            {describeScope(selector)}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {stat && stat.enabled && !incomplete && (
            <span
              className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] tabular-nums text-muted-foreground"
              title={`命中 ${stat.matched_count} 个节点,其中 ${stat.effective_count} 个由本规则决定出口`}
            >
              {stat.effective_count}
              {stat.matched_count !== stat.effective_count && (
                <span className="text-muted-foreground/60">/{stat.matched_count}</span>
              )}
            </span>
          )}
          {shadowed && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
              title="命中的节点全部被更靠前的规则抢走了,这条规则当前不产生任何效果"
            >
              <AlertTriangle className="h-3 w-3" />
              被遮蔽
            </span>
          )}
          <Switch
            checked={enabled}
            onCheckedChange={(v) => onUpdate({ enabled: v })}
            aria-label="启用本条规则"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onDuplicate} title="复制这条规则">
            <Copy className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove} title="删除这条规则">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-3 border-t px-3 py-3">
          <Row label="作用范围" hint="按策略组和指定节点是「或」的关系,与下面其它条件是「且」">
            <div className="space-y-1.5">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 inline-flex w-14 shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <Layers className="h-3 w-3" />
                  策略组
                </span>
                <div className="min-w-0 flex-1">
                  <SearchMultiSelect
                    options={groupOptions}
                    selected={selector.include_groups ?? []}
                    onChange={(v) => patchSelector({ include_groups: v })}
                    emptyLabel="未按策略组限定"
                    addLabel="选择策略组"
                    searchPlaceholder="搜索策略组…"
                    noOptionsHint="当前 Profile 还没引入任何策略组"
                  />
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-14 shrink-0 text-[11px] text-muted-foreground">指定节点</span>
                <div className="min-w-0 flex-1">
                  <SearchMultiSelect
                    options={nodeOptions}
                    selected={selector.include_nodes ?? []}
                    onChange={(v) => patchSelector({ include_nodes: v })}
                    emptyLabel="未点名具体节点"
                    addLabel="选择节点"
                    searchPlaceholder="搜索节点名…"
                    noOptionsHint="节点池为空 — 先在「节点来源」选机场"
                  />
                </div>
              </div>
            </div>
          </Row>

          <Row label="节点来源" hint="留空 = 不限机场(含以后新增的)">
            <SearchMultiSelect
              options={providerOptions}
              selected={selector.from_providers ?? []}
              onChange={(v) => patchSelector({ from_providers: v })}
              emptyLabel="全部机场"
              addLabel="选择机场"
              searchPlaceholder="搜索机场…"
              noOptionsHint="暂无节点源"
            />
          </Row>

          <Row label="地区白名单" hint="留空 = 不限地区">
            <ChipToggles
              options={regionOptions}
              selected={selector.include_region ?? []}
              onChange={(v) => patchSelector({ include_region: v })}
              emptyLabel="当前节点池没有可识别地区的节点"
            />
          </Row>

          <Row label="协议">
            <div className="space-y-1.5">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-8 shrink-0 text-[11px] text-muted-foreground">仅</span>
                <div className="min-w-0 flex-1">
                  <ChipToggles
                    options={typeOptions}
                    selected={selector.include_type ?? []}
                    onChange={(v) => patchSelector({ include_type: v })}
                    emptyLabel="不限协议"
                  />
                </div>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 w-8 shrink-0 text-[11px] text-muted-foreground">排除</span>
                <div className="min-w-0 flex-1">
                  <ChipToggles
                    options={typeOptions}
                    selected={selector.exclude_type ?? []}
                    onChange={(v) => patchSelector({ exclude_type: v })}
                    emptyLabel="不排除"
                    tone="destructive"
                  />
                </div>
              </div>
            </div>
          </Row>

          <Row label="名称正则" hint="默认大小写不敏感,不要写 (?i)">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Input
                value={selector.include_regex ?? ""}
                onChange={(e) => patchSelector({ include_regex: e.target.value || undefined })}
                placeholder="包含:stream|netflix"
                className="h-7 font-mono text-xs"
              />
              <Input
                value={selector.exclude_regex ?? ""}
                onChange={(e) => patchSelector({ exclude_regex: e.target.value || undefined })}
                placeholder="排除:到期|官网|流量"
                className="h-7 font-mono text-xs"
              />
            </div>
          </Row>

          <Row label="已有链式" hint="节点从机场原文带来的 dialer-proxy / underlying-proxy">
            <div className="flex flex-wrap items-center gap-1">
              <ModeButton
                active={(rule.mode ?? "override") === "override"}
                label="覆盖"
                title="命中即改写为本规则的出口,忽略机场原文的链式设置"
                onClick={() => onUpdate({ mode: "override" })}
              />
              <ModeButton
                active={rule.mode === "fill"}
                label="仅补空缺"
                title="机场原文已带链式的节点保持不动,只给没有的节点补上"
                onClick={() => onUpdate({ mode: "fill" })}
              />
              {stat && stat.kept_existing_count > 0 && (
                <span className="ml-1 text-[11px] text-muted-foreground">
                  {stat.kept_existing_count} 个节点保留了机场原设置
                </span>
              )}
            </div>
          </Row>

          <Row label="备注">
            <Input
              value={rule.comment ?? ""}
              onChange={(e) => onUpdate({ comment: e.target.value || undefined })}
              placeholder="给这条规则起个名字,例如「AI 组走 WARP 落地」"
              className="h-7 text-xs"
            />
          </Row>

          {stat && stat.sample.length > 0 && (
            <div className="rounded-md bg-muted/40 px-2.5 py-2">
              <div className="mb-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <CornerDownRight className="h-3 w-3" />
                命中节点样例
              </div>
              <div className="flex flex-wrap gap-1">
                {stat.sample.map((name) => (
                  <span
                    key={name}
                    className="max-w-[200px] truncate rounded bg-background px-1.5 py-0.5 text-[11px] font-mono"
                    title={name}
                  >
                    {name}
                  </span>
                ))}
                {stat.matched_count > stat.sample.length && (
                  <span className="px-1 py-0.5 text-[11px] text-muted-foreground">
                    …另外 {stat.matched_count - stat.sample.length} 个
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[104px_1fr] sm:gap-3">
      <div className="pt-0.5">
        <div className="text-[11px] font-medium">{label}</div>
        {hint && <div className="text-[10px] leading-snug text-muted-foreground/80">{hint}</div>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function ModeButton({
  active,
  label,
  title,
  onClick,
}: {
  active: boolean;
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        "rounded px-2 py-0.5 text-[11px] font-medium border transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
