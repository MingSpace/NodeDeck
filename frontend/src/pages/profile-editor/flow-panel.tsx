import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, RefreshCw, Route, Waypoints } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFlowPreview } from "./use-profile-form";
import { FlowGroupCard } from "./flow-group-card";
import type { FlowEntry, Profile } from "./types";

interface Props {
  profileId: string;
  draft: Profile;
}

const ENTRY_KIND_LABEL: Record<FlowEntry["kind"], string> = {
  ruleset: "规则集",
  geoip: "GEOIP",
  final: "兜底",
};

export function FlowPanel({ profileId, draft }: Props) {
  const preview = useFlowPreview(profileId, draft, true);
  const data = preview.data;
  const [focused, setFocused] = useState<string | null>(null);

  const groupsByName = useMemo(
    () => new Map((data?.groups ?? []).map((g) => [g.name, g])),
    [data?.groups],
  );

  // 规则指向的组排前面 —— 那是真正的流量入口,用户十有八九是来看它们的。
  const orderedGroups = useMemo(() => {
    const groups = data?.groups ?? [];
    const entryPolicies = new Set((data?.entries ?? []).map((e) => e.policy));
    return [...groups].sort((a, b) => {
      const ea = entryPolicies.has(a.name) ? 0 : 1;
      const eb = entryPolicies.has(b.name) ? 0 : 1;
      return ea - eb;
    });
  }, [data?.groups, data?.entries]);

  const jumpTo = (name: string) => {
    if (!groupsByName.has(name)) return;
    setFocused(name);
    document.getElementById(`flow-group-${name}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b bg-muted/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Waypoints className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">流转</span>
          <span className="text-[11px] text-muted-foreground/70">
            一次请求从规则命中到最终出站的完整走向
          </span>
          <div className="flex-1" />
          {preview.isFetching && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
        </div>
        {data && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              规则入口 <span className="font-medium tabular-nums text-foreground">{data.entries.length}</span>
            </span>
            <span>
              策略组 <span className="font-medium tabular-nums text-foreground">{data.groups.length}</span>
            </span>
            <span>
              节点池 <span className="tabular-nums">{data.node_count}</span>
            </span>
            <span>
              已挂链 <span className="tabular-nums">{data.chain_count}</span>
            </span>
            {data.hidden_count > 0 && (
              <span>
                仅链式可用 <span className="tabular-nums">{data.hidden_count}</span>
              </span>
            )}
            {data.revalidating && <span>机场首次拉取中,数字稍后自动补全…</span>}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {!data && preview.isLoading && <div className="text-xs text-muted-foreground">加载流转图…</div>}

        {preview.error && !data && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            流转图加载失败:{String(preview.error)}
          </div>
        )}

        {data && (
          <>
            <SectionTitle icon={<Route className="h-3.5 w-3.5" />} title="入口">
              规则从上往下匹配,命中即停
            </SectionTitle>
            {data.entries.length === 0 ? (
              <EmptyHint>这个 Profile 还没有启用任何规则模块</EmptyHint>
            ) : (
              <div className="mb-4 overflow-hidden rounded-lg border bg-card">
                {data.entries.map((e, i) => (
                  <EntryRow key={`${e.kind}-${e.label}-${i}`} entry={e} onJump={() => jumpTo(e.policy)} />
                ))}
              </div>
            )}

            <SectionTitle icon={<Waypoints className="h-3.5 w-3.5" />} title="策略组">
              点开嵌套的组可以一层层往下看
            </SectionTitle>
            {orderedGroups.length === 0 ? (
              <EmptyHint>这个 Profile 还没有引入任何策略组</EmptyHint>
            ) : (
              <div className="space-y-2">
                {orderedGroups.map((g) => (
                  <FlowGroupCard
                    key={g.name}
                    group={g}
                    groupsByName={groupsByName}
                    highlighted={focused === g.name}
                  />
                ))}
              </div>
            )}

            {data.warnings.length > 0 && (
              <div className="mt-3 space-y-1 rounded-lg border border-amber-300/50 bg-amber-50/60 px-3 py-2 dark:border-amber-800/50 dark:bg-amber-950/20">
                {data.warnings.map((w) => (
                  <div
                    key={w}
                    className="flex items-start gap-1.5 text-[11px] leading-relaxed text-amber-800 dark:text-amber-300"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EntryRow({ entry, onJump }: { entry: FlowEntry; onJump: () => void }) {
  const clickable = entry.policy_kind === "group";
  return (
    <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs last:border-b-0">
      <span className="w-12 shrink-0 text-[10px] text-muted-foreground/70">
        {ENTRY_KIND_LABEL[entry.kind]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={entry.label}>
          {entry.label}
        </div>
        {entry.detail && (
          <div className="truncate text-[10px] text-muted-foreground/70" title={entry.detail}>
            {entry.detail}
          </div>
        )}
      </div>
      <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
      <button
        type="button"
        onClick={clickable ? onJump : undefined}
        disabled={!clickable}
        title={
          entry.policy_kind === "unknown"
            ? "不是当前 Profile 里的策略组;可能是客户端专属策略(如 DEVICE:xxx),否则请到「规则 & 策略组」把它加进来"
            : clickable
              ? "跳到这个策略组"
              : undefined
        }
        className={cn(
          "max-w-[45%] shrink-0 truncate rounded px-1.5 py-0.5 font-mono text-[11px]",
          entry.policy_kind === "group" && "bg-primary/10 text-primary hover:bg-primary/20",
          entry.policy_kind === "builtin" && "bg-muted text-muted-foreground",
          entry.policy_kind === "unknown" &&
            "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
        )}
      >
        {entry.policy}
      </button>
    </div>
  );
}

function SectionTitle({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 px-0.5">
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {title}
      </span>
      <span className="text-[11px] text-muted-foreground/70">{children}</span>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 rounded-lg border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
      {children}
    </div>
  );
}
