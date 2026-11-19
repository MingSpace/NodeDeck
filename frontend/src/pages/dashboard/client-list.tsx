import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { RefreshedAt } from "@/components/refreshed-at";
import { cn } from "@/lib/utils";
import { formatAbsoluteTime, useRelativeTime } from "@/lib/relative-time";
import type { PullClient } from "./types";

const COLLAPSED = 5;

const SCOPE_LABEL: Partial<Record<PullClient["ip_scope"], string>> = {
  loopback: "本机",
  private: "内网",
};

/** 最近 7 天拉过订阅的客户端:第一行是「谁」(客户端 / 版本 / 系统 / 机型),第二行是「从哪、拉的哪份」 */
export function PullClientList({
  clients,
  profileName,
}: {
  clients: PullClient[];
  profileName: (id: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? clients : clients.slice(0, COLLAPSED);
  const hidden = clients.length - COLLAPSED;

  return (
    <div className="mt-4 border-t">
      <ul className="divide-y text-xs">
        {shown.map((d) => (
          <ClientRow
            key={`${d.ip}|${d.client}`}
            client={d}
            profile={profileName(d.profile_id)}
          />
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="mt-1 inline-flex items-center gap-1 rounded py-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <ChevronDown className={cn("h-3 w-3 transition-transform", expanded && "rotate-180")} />
          {expanded ? "收起" : `显示全部 ${clients.length} 个客户端`}
        </button>
      )}
    </div>
  );
}

function ClientRow({ client: d, profile }: { client: PullClient; profile: string }) {
  const firstSeen = useRelativeTime(d.first_seen);
  const version = d.version && (/^\d+$/.test(d.version) ? `build ${d.version}` : d.version);
  // 机型和系统合成一段:「Pixel 8 · Android 14」;都没有就不占位
  const platform = [d.device, d.os].filter(Boolean).join(" · ");
  const scope = SCOPE_LABEL[d.ip_scope];
  // UA 解析不出任何细节、又不只是客户端名本身时,直接把原文摆出来,至少看得到对方自称什么
  const rawUa = !version && !platform && d.components.length === 0 && d.user_agent && d.user_agent !== d.client;

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 py-2.5">

      <div className="min-w-0 space-y-0.5" title={d.user_agent || undefined}>
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <span className="font-medium text-foreground">{d.client}</span>
          {version && <span className="text-muted-foreground tabular-nums">{version}</span>}
          {platform && <span className="text-foreground/80">{platform}</span>}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-muted-foreground">
          <span className="tabular-nums">{d.ip}</span>
          {scope && <span className="rounded bg-secondary px-1 text-[10px] leading-4">{scope}</span>}
          <span aria-hidden>·</span>
          <span className="truncate">{profile}</span>
          {d.components.map((c) => (
            <span key={c} className="contents">
              <span aria-hidden>·</span>
              <span className="tabular-nums">{c}</span>
            </span>
          ))}
          {rawUa && (
            <>
              <span aria-hidden>·</span>
              <span className="truncate font-mono text-[11px]">{d.user_agent}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span title={formatAbsoluteTime(d.first_seen)}>首次 {firstSeen}</span>
        </div>
      </div>

      <div className="flex flex-col items-end gap-0.5 text-muted-foreground tabular-nums">
        <RefreshedAt ts={d.last_seen} className="text-right" />
        <span>共 {d.count} 次</span>
      </div>
    </li>
  );
}
