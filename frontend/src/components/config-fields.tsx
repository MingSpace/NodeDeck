import * as React from "react";
import { Info } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * 复杂配置表单的共享构件(Surge / General / Rule 可视化编辑复用)。
 * 目标:图标分组 + 悬停解释,让晦涩的 Surge 专属字段一目了然。
 */

/** 信息提示图标:悬停 / 聚焦展示解释文案,用于晦涩的配置项。 */
export function InfoHint({
  children,
  side = "top",
  className,
}: {
  children: React.ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="button"
          aria-label="说明"
          className={cn(
            "inline-flex shrink-0 cursor-help text-muted-foreground/60 outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
            className,
          )}
        >
          <Info className="h-3.5 w-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-[280px] whitespace-pre-wrap break-words text-xs leading-relaxed">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

/** 带标签的字段容器:标签 + 可选原始键名(mono) + 可选 hint 图标。 */
export function LabeledField({
  label,
  hint,
  raw,
  className,
  children,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  raw?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-1.5">
        <Label className="text-xs">{label}</Label>
        {raw && <code className="font-mono text-[10px] text-muted-foreground/70">{raw}</code>}
        {hint && <InfoHint>{hint}</InfoHint>}
      </div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/** 开关行:Switch + 标签 + 可选副标题 + 可选 hint,替代裸 checkbox。 */
export function ToggleRow({
  label,
  hint,
  raw,
  description,
  checked,
  onChange,
  badge,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  raw?: string;
  description?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  badge?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-2.5 py-1", className)}>
      <Switch
        checked={checked}
        onCheckedChange={onChange}
        aria-label={typeof label === "string" ? label : undefined}
        className="mt-0.5"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <span className="cursor-pointer select-none" onClick={() => onChange(!checked)}>
            {label}
          </span>
          {raw && <code className="font-mono text-[10px] text-muted-foreground/70">{raw}</code>}
          {badge}
          {hint && <InfoHint>{hint}</InfoHint>}
        </div>
        {description && (
          <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{description}</div>
        )}
      </div>
    </div>
  );
}

/** 分组卡片:图标 + 标题 + 可选 hint,让复杂表单分区更清晰。 */
export function FieldGroup({
  icon,
  title,
  hint,
  trailing,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  hint?: React.ReactNode;
  trailing?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("rounded-lg border bg-card/50", className)}>
      <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-xs font-medium">
        {icon && <span className="text-muted-foreground">{icon}</span>}
        <span className="flex-1">{title}</span>
        {hint && <InfoHint>{hint}</InfoHint>}
        {trailing}
      </div>
      <div className="space-y-3 p-3">{children}</div>
    </div>
  );
}
