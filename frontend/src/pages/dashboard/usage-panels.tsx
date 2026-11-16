import { Card } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { RefreshedAt } from "@/components/refreshed-at";
import { cn } from "@/lib/utils";
import type { PoolSummary, Profile, PullSummary } from "./types";

// Surge / Clash 用同一色相的深浅两档:只区分来源,不和状态色(绿 / 黄 / 红)抢语义
const TARGET_COLOR = {
  surge: "bg-sky-600 dark:bg-sky-400",
  clash: "bg-sky-300 dark:bg-sky-700",
} as const;

function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}/${Number(d)}`;
}

/** 订阅拉取:近 30 天每日柱状(Surge / Clash 堆叠)+ 最近 7 天拉过的客户端 */
export function PullsPanel({ data, profiles }: { data?: PullSummary; profiles: Profile[] }) {
  const days = data?.days ?? [];
  const max = Math.max(1, ...days.map((d) => d.clash + d.surge));
  const total = days.reduce((s, d) => s + d.clash + d.surge, 0);
  const devices = data?.devices ?? [];
  const profileName = new Map(profiles.map((p) => [p.id, p.name]));
  const showProfile = profiles.length > 1;
  // 统计是上线后才开始攒的:起始日落在窗口里时标出来,免得前面一排空柱被当成「没人用」
  const since = data?.since && days.length > 0 && data.since > days[0].date ? data.since : undefined;
  const sinceIndex = since ? days.findIndex((d) => d.date === since) : -1;

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="text-sm font-medium text-muted-foreground">订阅拉取</h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <Legend className={TARGET_COLOR.surge} label="Surge" />
          <Legend className={TARGET_COLOR.clash} label="Clash" />
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <Figure value={data?.today ?? "…"} unit="次" label="今天" />
        <Figure value={data ? total : "…"} unit="次" label="近 30 天" />
        <Figure value={data ? devices.length : "…"} unit="个" label="7 天内的客户端" />
      </div>

      <div className="mt-4">
        <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={`近 30 天共拉取 ${total} 次`}>
          {days.map((d) => {
            const sum = d.clash + d.surge;
            return (
              <Tooltip key={d.date}>
                <TooltipTrigger asChild>
                  <div className="group flex h-full min-w-0 flex-1 flex-col justify-end">
                    {sum === 0 ? (
                      <div className="h-px bg-border" />
                    ) : (
                      <div
                        className="flex flex-col overflow-hidden rounded-[2px] group-hover:opacity-80"
                        style={{ height: `${Math.max(4, (sum / max) * 100)}%` }}
                      >
                        <div className={TARGET_COLOR.surge} style={{ flexGrow: d.surge }} />
                        <div className={TARGET_COLOR.clash} style={{ flexGrow: d.clash }} />
                      </div>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent>
                  {shortDate(d.date)}:{sum === 0 ? "没有拉取" : `Surge ${d.surge} 次 · Clash ${d.clash} 次`}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        <div className="relative mt-1.5 h-4 text-xs text-muted-foreground tabular-nums">
          <span className="absolute left-0">{days[0] && shortDate(days[0].date)}</span>
          {/* 标签对准开始统计那一天的柱子;太靠两端会和首尾日期挤在一起,就不标 */}
          {since && sinceIndex > 2 && sinceIndex < days.length - 4 && (
            <span
              className="absolute whitespace-nowrap border-l border-dashed border-muted-foreground/50 pl-1"
              style={{ left: `${(sinceIndex / days.length) * 100}%` }}
            >
              {shortDate(since)} 开始统计
            </span>
          )}
          <span className="absolute right-0">今天</span>
        </div>
      </div>

      {data && devices.length === 0 ? (
        <p className="mt-4 border-t pt-3 text-xs text-muted-foreground">
          还没有客户端拉过订阅。在 Surge 或 Clash 里导入订阅链接后,这里会列出拉取的客户端。
        </p>
      ) : (
        devices.length > 0 && (
          <ul className="mt-4 divide-y border-t text-xs">
            {devices.slice(0, 5).map((d) => (
              <li key={`${d.ip}|${d.client}`} className="flex items-center gap-3 py-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", TARGET_COLOR[d.target])} aria-hidden />
                <span className="min-w-0 flex-1 truncate" title={d.user_agent || undefined}>
                  <span className="font-medium text-foreground">{d.client}</span>
                  <span className="text-muted-foreground">
                    {" "}
                    {d.ip}
                    {showProfile && ` · ${profileName.get(d.profile_id) ?? d.profile_id}`}
                  </span>
                </span>
                <span className="shrink-0 text-muted-foreground tabular-nums">{d.count} 次</span>
                <RefreshedAt ts={d.last_seen} className="w-16 shrink-0 text-right text-muted-foreground" />
              </li>
            ))}
            {devices.length > 5 && (
              <li className="pt-2 text-muted-foreground">另有 {devices.length - 5} 个客户端</li>
            )}
          </ul>
        )
      )}

      {!!data?.rejected && (
        <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
          近 30 天有 {data.rejected} 次请求因 token 不对被拒绝。不是你自己换过链接的话,检查订阅链接是否外泄。
        </p>
      )}
    </Card>
  );
}

const REGION_NAME: Record<string, string> = {
  HK: "香港",
  TW: "台湾",
  JP: "日本",
  SG: "新加坡",
  US: "美国",
  KR: "韩国",
  GB: "英国",
  DE: "德国",
  FR: "法国",
  CA: "加拿大",
  AU: "澳大利亚",
  NL: "荷兰",
  MO: "澳门",
  MY: "马来西亚",
  TH: "泰国",
  VN: "越南",
  PH: "菲律宾",
  IN: "印度",
  TR: "土耳其",
  RU: "俄罗斯",
  AE: "阿联酋",
};

const TOP_REGIONS = 6;

/** 节点池构成:地区排行(横向条)+ 协议占比 */
export function PoolPanel({ data }: { data?: PoolSummary }) {
  const regions = data?.regions ?? [];
  const known = regions.filter((r) => r.key !== "");
  const unknown = regions.find((r) => r.key === "")?.count ?? 0;
  const top = known.slice(0, TOP_REGIONS);
  const restCount = known.slice(TOP_REGIONS).reduce((s, r) => s + r.count, 0) + unknown;
  const rows = [
    ...top.map((r) => ({ key: r.key, label: REGION_NAME[r.key] ?? r.key, count: r.count })),
    ...(restCount > 0
      ? [{ key: "_rest", label: known.length > TOP_REGIONS ? "其他" : "未识别", count: restCount }]
      : []),
  ];
  const max = Math.max(1, ...rows.map((r) => r.count));
  const total = data?.total ?? 0;
  const types = data?.types ?? [];

  return (
    <Card className="p-4 sm:p-5">
      <h3 className="text-sm font-medium text-muted-foreground">节点池</h3>
      <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
        <Figure value={data ? total : "…"} unit="个" label="去重后" />
        <Figure value={data ? known.length : "…"} unit="个" label="地区" />
      </div>

      {data && total === 0 ? (
        <p className="mt-4 text-xs text-muted-foreground">
          {data.revalidating ? "节点源正在首次拉取,稍后刷新。" : "节点池是空的,先添加节点源。"}
        </p>
      ) : (
        <>
          <ul className="mt-4 space-y-1.5 text-xs">
            {rows.map((r) => (
              <li key={r.key} className="grid grid-cols-[4.5rem_minmax(0,1fr)_2.5rem] items-center gap-2">
                <span className={cn("truncate", r.key === "_rest" && "text-muted-foreground")}>
                  {r.label}
                </span>
                <span className="h-1.5 rounded-full bg-secondary">
                  <span
                    className={cn(
                      "block h-full rounded-full",
                      r.key === "_rest" ? "bg-muted-foreground/40" : "bg-foreground/70",
                    )}
                    style={{ width: `${(r.count / max) * 100}%` }}
                  />
                </span>
                <span className="text-right text-muted-foreground tabular-nums">{r.count}</span>
              </li>
            ))}
          </ul>

          {types.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-x-3 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
              {types.map((t) => (
                <span key={t.key} className="tabular-nums">
                  <span className="font-medium text-foreground">{t.key}</span> {t.count}
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </Card>
  );
}

function Figure({ value, unit, label }: { value: React.ReactNode; unit: string; label: string }) {
  return (
    <div>
      <span className="text-2xl font-semibold leading-none tabular-nums">{value}</span>
      <span className="ml-0.5 text-xs text-muted-foreground">{unit}</span>
      <span className="ml-1.5 text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-2 w-2 rounded-[2px]", className)} aria-hidden />
      {label}
    </span>
  );
}
