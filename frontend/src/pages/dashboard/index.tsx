import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Cloud, Loader2, Plus, Rss } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useEntityList, useDeleteEntity, useSaveEntity } from "@/api/entities";
import { toast } from "@/components/ui/toast";
import { EmptyState } from "@/components/empty-state";
import { DeleteEntityDialog, type DeleteTarget } from "@/components/delete-entity-dialog";
import { ProfileCard } from "./profile-card";
import { AirportCard } from "./airport-card";
import type { AirportItem, Profile, ProfileHealth } from "./types";

export function DashboardPage() {
  const navigate = useNavigate();
  const profileList = useEntityList<Profile>("profiles");
  const delProfile = useDeleteEntity("profiles");
  const saveProfile = useSaveEntity<Profile>("profiles");
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const airports = useQuery<{ items: AirportItem[] }>({
    queryKey: ["dashboard", "airports"],
    queryFn: () => api.get("/api/dashboard/airports"),
    refetchInterval: 60_000,
  });
  const health = useQuery<{ items: ProfileHealth[] }>({
    queryKey: ["dashboard", "profiles"],
    queryFn: () => api.get("/api/dashboard/profiles"),
    refetchInterval: 60_000,
  });
  const airportById = new Map((airports.data?.items ?? []).map((a) => [a.id, a]));
  const healthById = new Map((health.data?.items ?? []).map((h) => [h.id, h]));

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
      // 建完直接进编辑器并选中名称,省掉「回到列表再点编辑」这一步
      void navigate(`/profiles/${id}`, { state: { focusName: true } });
    } catch (err) {
      toast({
        title: "新建 Profile 失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setCreating(false);
    }
  };

  const onConfirmDelete = async (id: string) => {
    try {
      await delProfile.mutateAsync(id);
      toast({ title: "已删除", variant: "success" });
    } catch (err) {
      toast({
        title: "删除失败",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    }
    setDeleteTarget(null);
  };

  return (
    <div className="p-4 md:p-8 max-w-[1800px] mx-auto">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">仪表板</h1>

      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold">我的订阅</h2>
          <Button onClick={() => void onCreateProfile()} disabled={creating}>
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            新建 Profile
          </Button>
        </div>

        {profileList.data && profileList.data.items.length === 0 && (
          <EmptyState
            icon={Rss}
            title="还没有 Profile"
            description="Profile 把节点源、策略组和规则模块组合成一份订阅,生成 Clash 和 Surge 两种订阅链接,导入客户端即可使用。"
            action={
              <Button size="sm" variant="outline" onClick={() => void onCreateProfile()} disabled={creating}>
                <Plus className="h-3.5 w-3.5" />
                新建 Profile
              </Button>
            }
          />
        )}

        <div className="grid gap-3">
          {profileList.data?.items.map((p) => (
            <ProfileCard
              key={p.id}
              profile={p}
              updatedAt={profileList.data?.meta?.[p.id]?.updated_at}
              health={healthById.get(p.id)}
              airportById={airportById}
              onDelete={() => setDeleteTarget({ id: p.id, name: p.name })}
            />
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold">节点源</h2>
        </div>

        {airports.data && airports.data.items.length === 0 && (
          <EmptyState
            icon={Cloud}
            title="还没有节点源"
            description="添加机场的订阅 URL 后,这里会显示每个节点源的节点数、流量和到期时间。"
            action={
              // @user_flow: 直接给跳转按钮,?new=http 让落地页自动弹出「新建订阅」对话框
              <Button asChild size="sm" variant="outline">
                <Link to="/providers?new=http">
                  <Plus className="h-3.5 w-3.5" />
                  新建订阅
                </Link>
              </Button>
            }
          />
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
          {airports.data?.items.map((a) => (
            <AirportCard key={a.id} airport={a} />
          ))}
        </div>
      </section>

      <DeleteEntityDialog
        kind="profiles"
        targets={deleteTarget ? [deleteTarget] : []}
        open={deleteTarget !== null}
        onOpenChange={(v) => {
          if (!v) setDeleteTarget(null);
        }}
        onConfirm={(ids) => void onConfirmDelete(ids[0])}
        busy={delProfile.isPending}
      />
    </div>
  );
}

function randomToken(len: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
