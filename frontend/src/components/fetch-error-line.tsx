import { Link } from "react-router-dom";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { splitFetchErrorRoutes, summarizeFetchError } from "@/lib/fetch-error";
import { cn } from "@/lib/utils";

interface FetchErrorLineProps {
  error: string;
  /** stale = 没拉到但还在沿用上次的节点(琥珀色);error = 没有节点可用(红色) */
  tone: "stale" | "error";
  /** 跟在原因后面的补充,如「已失败 2 次」;放在 tooltip 触发区外面,里面可以再套 RefreshedAt */
  extra?: React.ReactNode;
  /** 给了就整句可点,跳到节点源详情 */
  to?: string;
  className?: string;
}

/** 节点源拉取失败的一行摘要:卡片上只放一句人话,后端原文在 hover 里 */
export function FetchErrorLine({ error, tone, extra, to, className }: FetchErrorLineProps) {
  const Icon = tone === "stale" ? AlertTriangle : AlertCircle;
  const summary = (
    <>
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{summarizeFetchError(error)}</span>
    </>
  );
  const triggerClass = cn(
    "flex min-w-0 items-center gap-1.5",
    to && "hover:underline underline-offset-2",
  );

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-1.5 text-xs",
        tone === "stale" ? "text-amber-700 dark:text-amber-400" : "text-destructive",
        className,
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          {to ? (
            <Link to={to} className={triggerClass} onClick={(e) => e.stopPropagation()}>
              {summary}
            </Link>
          ) : (
            <span className={cn(triggerClass, "cursor-help")}>{summary}</span>
          )}
        </TooltipTrigger>
        <TooltipContent
          side="bottom"
          align="start"
          className="max-w-md whitespace-pre-wrap break-words text-xs leading-relaxed"
        >
          {/* 多条线路的原因拼在一起,拆成一行一条 */}
          {splitFetchErrorRoutes(error).map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </TooltipContent>
      </Tooltip>
      {extra && <span className="shrink-0 text-muted-foreground">· {extra}</span>}
    </div>
  );
}
