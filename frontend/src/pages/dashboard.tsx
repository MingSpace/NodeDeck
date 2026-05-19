import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Cloud,
  FileText,
  AlertCircle,
  Clock,
  Calendar,
  Plus,
  Edit,
  Trash2,
  Copy,
  Ban,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { RefreshedAt } from "@/components/refreshed-at";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useEntityList, useDeleteEntity, useSaveEntity } from "@/api/entities";
import { toast } from "@/components/ui/toast";

type ProviderType = "http" | "file" | "inline";

const PROVIDER_TYPE_ICON: Record<
  ProviderType,
  { Icon: LucideIcon; label: string }
> = {
  http: { Icon: Cloud, label: "URL 订阅" },
  inline: { Icon: FileText, label: "静态节点" },
  file: { Icon: FileText, label: "静态节点" },
};

interface AirportItem {
  id: string;
  name: string;
  type: ProviderType;
  url?: string;
  enabled: boolean;
  status: "ok" | "stale" | "error" | "unknown";
  node_count: number;
  fetched_at?: number;
  error?: string;
  userinfo?: { upload: number; download: number; total: number; expire: number };
  raw_userinfo_header?: string;
}

interface Profile {
  id: string;
  name: string;
  description?: string;
  token: string;
  providers: string[];
  proxy_groups: string[];
  rule_modules: unknown[];
  chain_rules: unknown[];
  surge_modules: string[];
}

export function DashboardPage() {
  const profileList = useEntityList<Profile>("profiles");
  const delProfile = useDeleteEntity("profiles");
  const saveProfile = useSaveEntity<Profile>("profiles");
  const [creating, setCreating] = useState(false);

  const airports = useQuery<{ items: AirportItem[] }>({
    queryKey: ["dashboard", "airports"],
    queryFn: () => api.get("/api/dashboard/airports"),
    refetchInterval: 60_000,
  });

  const onCreateProfile = async () => {
    setCreating(true);
    try {
      const id = `profile-${Date.now().toString(36)}`;
      const newProfile: Profile = {
        id,
        name: "新 Profile",
        token: randomToken(12),
        providers: [],
        proxy_groups: [],
        rule_modules: [],
        chain_rules: [],
        surge_modules: [],
      };
      const extras = {
        node_filter: { rename_rules: [], exclude_types: [] },
        userinfo: { mode: "sum", expose_per_provider_headers: true },
        managed_config_url: "auto",
        managed_config_interval: 86400,
        managed_config_strict: false,
        clash_options: { use_proxy_providers: false, flag: "mihomo", group_style: "flow" },
      };
      await saveProfile.mutateAsync({ ...newProfile, ...(extras as Record<string, unknown>) } as Profile);
      toast({ title: "已创建", variant: "success" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-8 max-w-[1800px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">仪表板</h1>
        <p className="text-muted-foreground mt-1">订阅与节点源</p>
      </div>

      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">我的订阅</h2>
          <Button onClick={onCreateProfile} disabled={creating}>
            <Plus className="h-4 w-4" />
            新建 Profile
          </Button>
        </div>

        {profileList.data && profileList.data.items.length === 0 && (
          <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
            暂无 Profile,点击右上角新建
          </div>
        )}

        <div className="grid gap-3">
          {profileList.data?.items.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              onDelete={async () => {
                if (!window.confirm(`删除 Profile "${p.name}"?`)) return;
                await delProfile.mutateAsync(p.id);
                toast({ title: "已删除", variant: "success" });
              }}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold">节点源</h2>
        </div>

        {airports.data && airports.data.items.length === 0 && (
          <div className="rounded-lg border border-dashed p-12 flex flex-col items-center gap-3 text-muted-foreground">
            <span>暂无节点源，前往节点源页面添加</span>
            {/* @user_flow: 直接给跳转按钮,?new=http 让落地页自动弹出「新建订阅」对话框 */}
            <Button asChild size="sm" variant="outline">
              <Link to="/providers?new=http">
                <Plus className="h-4 w-4" />
                新建订阅
              </Link>
            </Button>
          </div>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          {airports.data?.items.map((a) => (
            <AirportCard key={a.id} airport={a} />
          ))}
        </div>
      </section>
    </div>
  );
}

function ProfileCard({ profile, onDelete }: { profile: Profile; onDelete: () => void | Promise<void> }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-base">{profile.name}</span>
            <Badge variant="outline" className="text-xs font-mono">
              {profile.id}
            </Badge>
          </div>
          {profile.description && <p className="text-sm text-muted-foreground mt-1">{profile.description}</p>}
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mt-2">
            <span>{profile.providers.length} 个 Provider</span>
            <span>{profile.proxy_groups.length} 个策略组</span>
            <span>{profile.rule_modules.length} 个规则模块</span>
            <span>{profile.chain_rules.length} 条链式规则</span>
            <span>{profile.surge_modules.length} 个 Surge 模块</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            <SubLinkButton profileId={profile.id} target="clash" />
            <SubLinkButton profileId={profile.id} target="surge" />
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button asChild variant="outline" size="sm">
            <Link to={`/profiles/${profile.id}`}>
              <Edit className="h-4 w-4" />
              编辑
            </Link>
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void onDelete()}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>
    </Card>
  );
}

function SubLinkButton({ profileId, target }: { profileId: string; target: "clash" | "surge" }) {
  const onCopy = async () => {
    try {
      const res = await fetch(`/api/profiles/${profileId}/url?target=${target}`, { credentials: "include" });
      const data = (await res.json()) as { url: string };
      await navigator.clipboard.writeText(data.url);
      toast({ title: "URL 已复制", description: data.url, variant: "success" });
    } catch (err) {
      toast({ title: "获取 URL 失败", description: String(err), variant: "error" });
    }
  };
  return (
    <Button size="sm" variant="secondary" onClick={onCopy}>
      <Copy className="h-3.5 w-3.5" />
      复制 {target === "clash" ? "Clash" : "Surge"} 订阅 URL
    </Button>
  );
}

function AirportCard({ airport }: { airport: AirportItem }) {
  const ui = airport.userinfo;
  const usedBytes = ui ? ui.upload + ui.download : 0;
  const totalBytes = ui?.total ?? 0;
  const usedPercent = totalBytes > 0 ? (usedBytes / totalBytes) * 100 : 0;
  const remainPercent = 100 - usedPercent;

  const expireSec = ui?.expire ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);
  const daysLeft = expireSec > 0 ? Math.ceil((expireSec - nowSec) / 86400) : null;

  const expireWarn = daysLeft !== null && daysLeft <= 7;
  const trafficWarn = totalBytes > 0 && remainPercent <= 10;

  const statusBadge = (() => {
    if (airport.status === "ok") return <Badge variant="success">健康</Badge>;
    if (airport.status === "stale")
      return (
        <Badge variant="warning">
          <Clock className="h-3 w-3" /> 旧缓存
        </Badge>
      );
    if (airport.status === "error")
      return (
        <Badge variant="destructive">
          <AlertCircle className="h-3 w-3" /> 失败
        </Badge>
      );
    return <Badge variant="secondary">未知</Badge>;
  })();

  const { Icon: TypeIcon, label: typeLabel } =
    PROVIDER_TYPE_ICON[airport.type] ?? PROVIDER_TYPE_ICON.http;

  return (
    <Card
      className={cn(
        "p-4 transition-opacity",
        expireWarn || trafficWarn ? "border-amber-300" : "",
        !airport.enabled && "opacity-60 bg-muted/20 hover:opacity-100",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "font-medium truncate",
                !airport.enabled && "line-through decoration-1",
              )}
            >
              {airport.name}
            </span>
            {statusBadge}
            {!airport.enabled && (
              <Badge variant="disabled" className="flex items-center gap-1">
                <Ban className="h-3 w-3" /> 已禁用
              </Badge>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{airport.id} · {airport.node_count} 节点</div>
        </div>
        <div
          className="text-muted-foreground shrink-0"
          aria-label={typeLabel}
          title={typeLabel}
        >
          <TypeIcon className="h-5 w-5" />
        </div>
      </div>

      {ui && (
        <div className="mt-3 space-y-2">
          {totalBytes > 0 ? (
            <div>
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">流量</span>
                <span className={trafficWarn ? "text-amber-600 font-medium" : ""}>
                  {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
                </span>
              </div>
              <div className="h-2 bg-secondary rounded-full overflow-hidden">
                <div
                  className={`h-full ${trafficWarn ? "bg-amber-500" : "bg-emerald-500"}`}
                  style={{ width: `${Math.min(usedPercent, 100)}%` }}
                />
              </div>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">无流量限额信息</div>
          )}
          {daysLeft !== null && (
            <div className={`flex items-center gap-1.5 text-xs ${expireWarn ? "text-amber-600 font-medium" : "text-muted-foreground"}`}>
              <Calendar className="h-3 w-3" />
              {daysLeft > 0 ? `还剩 ${daysLeft} 天` : "已过期"} · {new Date(expireSec * 1000).toLocaleDateString()}
            </div>
          )}
        </div>
      )}

      {airport.fetched_at && (
        <div className="mt-3 text-xs text-muted-foreground">
          上次刷新： <RefreshedAt ts={airport.fetched_at} />
        </div>
      )}
      {airport.error && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to={`/providers?focus=${encodeURIComponent(airport.id)}`}
              className="mt-2 block text-xs text-destructive bg-destructive/10 hover:bg-destructive/20 rounded p-2 line-clamp-2 cursor-pointer transition-colors"
            >
              {airport.error}
            </Link>
          </TooltipTrigger>
          <TooltipContent
            side="bottom"
            align="start"
            className="max-w-md whitespace-pre-wrap break-words text-xs leading-relaxed"
          >
            <div>{airport.error}</div>
            <div className="mt-1 text-muted-foreground">点击跳转到节点源详情</div>
          </TooltipContent>
        </Tooltip>
      )}
    </Card>
  );
}

function formatBytes(b: number): string {
  if (b === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function randomToken(len: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
