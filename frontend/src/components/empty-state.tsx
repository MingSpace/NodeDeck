import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  /** 说明这个东西是干什么用的,而不是重复「暂无」 */
  description?: React.ReactNode;
  /** 通常是一个「新建 / 添加第一个」按钮 */
  action?: React.ReactNode;
  className?: string;
}

/** 列表为空时的统一占位:图标 + 标题 + 用途说明 + 下一步动作 */
export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("rounded-lg border border-dashed px-6 py-10 text-center", className)}>
      <Icon className="mx-auto h-6 w-6 text-muted-foreground/50" />
      <div className="mt-2 text-sm font-medium">{title}</div>
      {description && (
        <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-3 flex justify-center gap-2">{action}</div>}
    </div>
  );
}
