import { Link } from "react-router-dom";
import { CircleAlert, Cloud, Copy, Download, FilePen, Globe, Layers, LoaderCircle, Lock, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { formatAbsoluteTime, useRelativeTime } from "@/lib/relative-time";
import { useRefreshModule, type ModuleStatus } from "./api";
import { LOCAL_SECTION_LABELS, type SurgeModuleData } from "./visual-form";

interface Props {
  module: SurgeModuleData;
  status?: ModuleStatus;
  /** 把这个模块并进 Surge 订阅的 Profile;undefined = 列表还在加载 */
  usedBy?: { id: string; name: string }[];
}

/** 列表行附加信息:来源 + 内容概况 / 远程拉取状态,以及设备安装用的链接 */
export function ModuleRow({ module: m, status, usedBy }: Props) {
  const remote = (m.source ?? "local") === "remote";
  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded border px-1.5 py-px text-[11px]",
            remote ? "border-sky-500/40 text-sky-700 dark:text-sky-300" : "text-muted-foreground",
          )}
        >
          {remote ? <Cloud className="h-3 w-3" /> : <FilePen className="h-3 w-3" />}
          {remote ? "远程" : "本地"}
        </span>
        {remote ? <RemoteSummary module={m} status={status} /> : <LocalSummary module={m} />}
      </div>
      {usedBy && <UsedBy profiles={usedBy} />}
      {status && <LinkActions module={m} status={status} />}
    </div>
  );
}

function UsedBy({ profiles }: { profiles: { id: string; name: string }[] }) {
  if (profiles.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-muted-foreground/70">
        <Layers className="h-3 w-3 shrink-0" />
        没有订阅引用,只能用下面的链接单独安装
      </div>
    );
  }
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <Layers className="h-3 w-3 shrink-0" />
      <span className="shrink-0">并入订阅</span>
      {profiles.map((p) => (
        <Link
          key={p.id}
          to={`/profiles/${encodeURIComponent(p.id)}`}
          title={`打开 Profile「${p.name}」`}
          className="rounded bg-secondary px-1.5 py-px text-[11px] font-medium text-secondary-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {p.name}
        </Link>
      ))}
    </div>
  );
}

function LocalSummary({ module: m }: { module: SurgeModuleData }) {
  const sections = LOCAL_SECTION_LABELS.filter(({ key }) => m.content_sections?.[key]?.trim()).map((s) => s.label);
  return (
    <span className="truncate">
      {m.description ? `${m.description} · ` : ""}
      {sections.length > 0 ? sections.join(" / ") : "还没有内容"}
    </span>
  );
}

function RemoteSummary({ module: m, status }: { module: SurgeModuleData; status?: ModuleStatus }) {
  const cache = status?.remote;
  const okAgo = useRelativeTime(cache?.ok_at ?? null);
  let host = m.url ?? "";
  try {
    host = new URL(m.url ?? "").host;
  } catch {
    // 留原文
  }
  if (!status) return <span className="truncate">{host}</span>;
  if (cache === null || cache === undefined) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        <LoaderCircle className="h-3 w-3 shrink-0 animate-spin" />
        <span className="truncate">{host} · 正在拉取…</span>
      </span>
    );
  }
  if (cache.status === "ok") {
    return (
      <span className="truncate" title={cache.ok_at ? formatAbsoluteTime(cache.ok_at) : undefined}>
        {host} · {cache.name ?? "未命名"} · {okAgo}拉取
        {cache.sections && cache.sections.length > 0 ? ` · ${cache.sections.join(" / ")}` : ""}
      </span>
    );
  }
  // 拉取失败:有旧内容 → 黄色(仍可用);没有 → 红色(引用它的 Profile 不会并入,安装链接返回 502)
  const stale = cache.bytes !== undefined;
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5",
        stale ? "text-amber-600 dark:text-amber-400" : "text-destructive",
      )}
      title={cache.error}
    >
      <CircleAlert className="h-3 w-3 shrink-0" />
      <span className="truncate">
        {host} · 拉取失败{stale ? `,沿用 ${okAgo}的内容` : ",暂无可用内容"}:{cache.error}
      </span>
    </span>
  );
}

function LinkActions({ module: m, status }: { module: SurgeModuleData; status: ModuleStatus }) {
  const refresh = useRefreshModule();
  const remote = status.source === "remote";
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(status.url);
      toast({
        title: "已复制模块链接",
        description: status.public
          ? "在 Surge 的「模块 → 安装新模块」里粘贴即可"
          : "链接里带访问 token,不要发到公开的地方;在 Surge 的「模块 → 安装新模块」里粘贴即可",
        variant: "success",
      });
    } catch (err) {
      toast({ title: "复制失败", description: err instanceof Error ? err.message : String(err), variant: "error" });
    }
  };
  const onRefresh = () =>
    refresh.mutate(m.id, {
      onSuccess: (res) =>
        res.remote?.status === "ok"
          ? toast({ title: `已刷新「${m.name}」`, variant: "success" })
          : toast({ title: `「${m.name}」拉取失败`, description: res.remote?.error, variant: "error" }),
      onError: (err) => toast({ title: "刷新失败", description: err.message, variant: "error" }),
    });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className="inline-flex shrink-0 items-center"
        title={status.public ? "公开链接:不带 token 也能访问" : "链接带模块专属 token,不对返回 404"}
      >
        {status.public ? (
          <Globe className="h-3 w-3 text-amber-600 dark:text-amber-400" />
        ) : (
          <Lock className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
        )}
      </span>
      {/* token 打码显示,复制按钮拿到完整链接;截图 / 共享屏幕不顺手泄露 */}
      <code className="max-w-full truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">
        {status.url.replace(/([?&]t=)[^&]+/, "$1••••••")}
      </code>
      <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => void onCopy()}>
        <Copy className="h-3 w-3" />
        复制链接
      </Button>
      <Button asChild size="sm" variant="ghost" className="h-6 px-2 text-xs">
        <a href={status.install_url} title="在装了 Surge 的设备上点开,一键安装该模块">
          <Download className="h-3 w-3" />
          安装到 Surge
        </a>
      </Button>
      {remote && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs"
          disabled={refresh.isPending}
          onClick={onRefresh}
          title="立刻重新拉取远程内容(平时缓存 5 分钟)"
        >
          <RefreshCw className={cn("h-3 w-3", refresh.isPending && "animate-spin")} />
          刷新
        </Button>
      )}
    </div>
  );
}
