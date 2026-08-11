import { Clock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatAbsoluteTime, useRelativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

interface RefreshedAtProps {
  /** epoch ms */
  ts: number;
  className?: string;
}

/**
 * 相对时间显示(如"3 分钟前"),hover 时通过 tooltip 展示绝对时间。
 * 触发器带虚线下划线提示"可悬停"。
 */
export function RefreshedAt({ ts, className }: RefreshedAtProps) {
  const rel = useRelativeTime(ts);
  const abs = formatAbsoluteTime(ts);
  const iso = new Date(ts).toISOString();

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <time
          dateTime={iso}
          onClick={(e) => e.stopPropagation()}
          className={cn(
            "cursor-help underline decoration-dotted decoration-muted-foreground/40 underline-offset-2 hover:decoration-muted-foreground",
            className,
          )}
        >
          {rel}
        </time>
      </TooltipTrigger>
      <TooltipContent>{abs}</TooltipContent>
    </Tooltip>
  );
}

interface UpdatedAtProps {
  /** epoch ms;undefined / null 时整块不渲染(如配置文件还没落过盘) */
  ts: number | null | undefined;
  /** 默认「更新于」,provider 卡片等已有「上次刷新」的地方用「配置更新于」区分 */
  label?: string;
  className?: string;
}

/**
 * 配置文件(yaml)的最后修改时间。时间来自文件 mtime,不是实体字段。
 */
export function UpdatedAt({ ts, label = "更新于", className }: UpdatedAtProps) {
  if (ts == null) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 whitespace-nowrap", className)}>
      <Clock className="h-3 w-3 shrink-0" />
      {label} <RefreshedAt ts={ts} />
    </span>
  );
}
