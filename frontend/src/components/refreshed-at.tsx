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
