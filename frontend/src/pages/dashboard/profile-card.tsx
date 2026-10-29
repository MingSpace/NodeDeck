import { Link } from "react-router-dom";
import { Copy, Edit, MoreHorizontal, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { UpdatedAt } from "@/components/refreshed-at";
import { toast } from "@/components/ui/toast";
import { ProfilePipeline, type PipelineStage } from "@/components/profile-pipeline";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api } from "@/lib/api";
import type { AirportItem, Profile, ProfileHealth } from "./types";

export function ProfileCard({
  profile,
  updatedAt,
  health,
  airportById,
  onDelete,
}: {
  profile: Profile;
  updatedAt?: number;
  health?: ProfileHealth;
  airportById: Map<string, AirportItem>;
  onDelete: () => void;
}) {
  const editUrl = `/profiles/${encodeURIComponent(profile.id)}`;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <Link
              to={editUrl}
              className="truncate text-base font-semibold hover:underline underline-offset-4"
              title={`id: ${profile.id}`}
            >
              {profile.name}
            </Link>
            <UpdatedAt ts={updatedAt} className="text-xs text-muted-foreground" />
          </div>
          {profile.description && <p className="mt-1 text-sm text-muted-foreground">{profile.description}</p>}
        </div>
        <div className="flex items-center gap-2">
          {/* 手机上最常做的就是复制订阅链接,两个按钮各占一半宽 */}
          <div className="grid flex-1 grid-cols-2 gap-2 sm:flex sm:flex-none">
            <SubLinkButton profileId={profile.id} target="clash" />
            <SubLinkButton profileId={profile.id} target="surge" />
          </div>
          <Button asChild variant="outline" size="sm" className="hidden sm:inline-flex">
            <Link to={editUrl}>
              <Edit className="h-4 w-4" />
              编辑
            </Link>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0" title="更多操作">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem asChild className="sm:hidden">
                <Link to={editUrl}>
                  <Edit />
                  编辑
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem destructive onSelect={onDelete}>
                <Trash2 />
                删除
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ProfilePipeline
        className="mt-4 border-t pt-4"
        stages={buildStages(profile, editUrl, health, airportById)}
      />
    </Card>
  );
}

function buildStages(
  profile: Profile,
  editUrl: string,
  health: ProfileHealth | undefined,
  airportById: Map<string, AirportItem>,
): PipelineStage[] {
  const section = (s: string) => `${editUrl}?section=${s}`;

  // 节点源:看这份订阅选中的源里有没有失败 / 沿用旧节点 / 被禁用的
  const selected = profile.providers.map((id) => airportById.get(id)).filter((a): a is AirportItem => !!a);
  const failed = selected.filter((a) => a.enabled && a.status === "error");
  const stale = selected.filter((a) => a.enabled && a.status === "stale");
  const disabled = selected.filter((a) => !a.enabled);
  const providerStage: PipelineStage = {
    key: "providers",
    label: "节点源",
    value: profile.providers.length,
    to: section("nodes"),
    ...(profile.providers.length === 0
      ? { tone: "warn", note: "还没选节点源" }
      : failed.length > 0
        ? { tone: "error", note: `${failed.length} 个拉取失败` }
        : stale.length > 0
          ? { tone: "warn", note: `${stale.length} 个沿用旧节点` }
          : disabled.length > 0
            ? { tone: "warn", note: `${disabled.length} 个已禁用` }
            : { tone: "ok", note: "都正常" }),
    detail:
      failed.length + stale.length + disabled.length > 0
        ? [
            ...failed.map((a) => `${a.name}:拉取失败`),
            ...stale.map((a) => `${a.name}:${a.offline ? "离线" : "这次没拉到"},沿用上次的 ${a.node_count} 个节点`),
            ...disabled.map((a) => `${a.name}:已禁用,不出节点`),
          ].map((line) => <div key={line}>{line}</div>)
        : undefined,
  };

  const nodeStage: PipelineStage = !health
    ? { key: "nodes", label: "节点", value: "…", tone: "idle", to: section("nodes") }
    : {
        key: "nodes",
        label: "节点",
        value: health.node_count,
        to: section("nodes"),
        ...(health.node_count > 0
          ? { tone: "ok", note: "过滤后" }
          : health.revalidating
            ? { tone: "idle", note: "首次拉取中" }
            : { tone: "error", note: "没有可用节点" }),
      };

  const ruleRefs = profile.rule_modules.filter((m) => typeof (m as { ref?: unknown }).ref === "string");
  const final = profile.rule_modules.find((m) => typeof (m as { final?: unknown }).final === "string") as
    | { final: string }
    | undefined;

  const warnings = health?.warnings ?? [];
  const outputStage: PipelineStage = !health
    ? { key: "output", label: "订阅", value: "…", tone: "idle", to: editUrl }
    : warnings.length === 0
      ? { key: "output", label: "订阅", value: "可用", tone: "ok", note: "生成无警告", to: editUrl }
      : {
          key: "output",
          label: "订阅",
          // 单位缩小跟在数字后面,窄屏一格只有 60px 左右,整串大字会折行
          value: (
            <>
              {warnings.length}
              <span className="ml-0.5 text-xs font-normal">条警告</span>
            </>
          ),
          tone: "warn",
          note: "点开看实时预览",
          to: editUrl,
          detail: (
            <ul className="list-disc space-y-0.5 pl-4">
              {warnings.slice(0, 6).map((w) => (
                <li key={w}>{w}</li>
              ))}
              {warnings.length > 6 && <li className="list-none">还有 {warnings.length - 6} 条…</li>}
            </ul>
          ),
        };

  return [
    providerStage,
    nodeStage,
    {
      key: "groups",
      label: "策略组",
      value: profile.proxy_groups.length,
      tone: profile.proxy_groups.length > 0 ? "ok" : "idle",
      note:
        profile.proxy_groups.length === 0
          ? "未添加"
          : profile.chain_rules.length > 0
            ? `另有 ${profile.chain_rules.length} 条链式代理`
            : undefined,
      to: section("rules"),
    },
    {
      key: "rules",
      label: "规则",
      value: ruleRefs.length,
      tone: ruleRefs.length > 0 || final ? "ok" : "idle",
      note: final ? `兜底走 ${final.final}` : "没有兜底规则",
      to: section("rules"),
    },
    outputStage,
  ];
}

function SubLinkButton({ profileId, target }: { profileId: string; target: "clash" | "surge" }) {
  const label = target === "clash" ? "Clash" : "Surge";
  const onCopy = async () => {
    try {
      const data = await api.get<{ url: string }>(
        `/api/profiles/${encodeURIComponent(profileId)}/url?target=${target}`,
      );
      await navigator.clipboard.writeText(data.url);
      // 链接里带着 token,提示里不回显完整地址,免得截图 / 共享屏幕时顺手泄露
      toast({
        title: `已复制 ${label} 订阅链接`,
        description: "链接里带访问 token,不要发到公开的地方",
        variant: "success",
      });
    } catch (err) {
      toast({
        title: `复制 ${label} 订阅链接失败`,
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
  };
  return (
    <Button size="sm" variant="secondary" onClick={() => void onCopy()}>
      <Copy className="h-3.5 w-3.5" />
      复制 {label} 链接
    </Button>
  );
}
