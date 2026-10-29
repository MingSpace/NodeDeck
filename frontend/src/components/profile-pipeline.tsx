import { Link } from "react-router-dom";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type StageTone = "ok" | "warn" | "error" | "idle";

export interface PipelineStage {
  key: string;
  label: string;
  /** 大号数字,或「…」表示还在算 */
  value: React.ReactNode;
  /** 数字下面一行小字,说明这一段的状态;窄屏下隐藏,只留圆点颜色 */
  note?: React.ReactNode;
  tone: StageTone;
  /** 点这一段跳去哪里改 */
  to: string;
  /** hover 时的完整说明,如警告列表 */
  detail?: React.ReactNode;
}

const DOT: Record<StageTone, string> = {
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  error: "bg-destructive",
  idle: "bg-muted-foreground/30",
};

const NOTE: Record<StageTone, string> = {
  ok: "text-muted-foreground",
  warn: "text-amber-700 dark:text-amber-400",
  error: "text-destructive",
  idle: "text-muted-foreground",
};

/**
 * 一份订阅从节点源到产物的流水线,画成一条线路图:每站一个圆点,颜色就是这一站的健康度,
 * 哪一站出了问题一眼能看到,点进去直接到编辑器里对应的标签页。
 */
export function ProfilePipeline({ stages, className }: { stages: PipelineStage[]; className?: string }) {
  return (
    <ol className={cn("grid", className)} style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}>
      {stages.map((stage, i) => {
        const last = i === stages.length - 1;
        const body = (
          <Link
            to={stage.to}
            className="group block rounded-md pb-1 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="relative flex h-3 items-center">
              {/* 线段画在圆点右边,一直连到下一站的圆点;最后一站后面不再有线 */}
              {!last && <span className="absolute left-1.5 right-[-0.5rem] top-1/2 h-0.5 -translate-y-1/2 bg-border" />}
              <span
                className={cn(
                  "relative h-3 w-3 rounded-full ring-4 ring-card transition-transform group-hover:scale-125",
                  DOT[stage.tone],
                )}
              />
            </div>
            <div className="mt-2 text-xs text-muted-foreground group-hover:text-foreground">{stage.label}</div>
            <div className="text-lg font-semibold leading-tight tabular-nums">{stage.value}</div>
            {stage.note && (
              <div className={cn("mt-0.5 hidden truncate text-xs sm:block", NOTE[stage.tone])}>{stage.note}</div>
            )}
          </Link>
        );
        return (
          <li key={stage.key} className="min-w-0">
            {stage.detail ? (
              <Tooltip>
                <TooltipTrigger asChild>{body}</TooltipTrigger>
                <TooltipContent side="bottom" align="start" className="max-w-md text-xs leading-relaxed">
                  {stage.detail}
                </TooltipContent>
              </Tooltip>
            ) : (
              body
            )}
          </li>
        );
      })}
    </ol>
  );
}
