import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Edit, Trash2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useEntityList, useDeleteEntity, useSaveEntity } from "@/api/entities";
import { toast } from "@/components/ui/toast";

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

export function ProfilesPage() {
  const list = useEntityList<Profile>("profiles");
  const del = useDeleteEntity("profiles");
  const save = useSaveEntity<Profile>("profiles");
  const [creating, setCreating] = useState(false);

  const onCreate = async () => {
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
        include_manual_nodes: true,
        node_filter: { rename_rules: [], exclude_types: [] },
        userinfo: { mode: "sum", expose_per_provider_headers: true },
        managed_config_url: "auto",
        managed_config_interval: 86400,
        managed_config_strict: false,
        clash_options: { use_proxy_providers: false, flag: "mihomo", group_style: "flow" },
      };
      await save.mutateAsync({ ...newProfile, ...(extras as Record<string, unknown>) } as Profile);
      toast({ title: "已创建", variant: "success" });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Profiles</h1>
          <p className="text-muted-foreground mt-1">订阅档案: 节点 + 规则 + 策略组 + 链式 + General + 模块 → 订阅 URL</p>
        </div>
        <Button onClick={onCreate} disabled={creating}>
          <Plus className="h-4 w-4" />
          新建 Profile
        </Button>
      </div>

      {list.data && list.data.items.length === 0 && (
        <div className="rounded-lg border border-dashed p-12 text-center text-muted-foreground">
          暂无 Profile,点击右上角新建
        </div>
      )}

      <div className="grid gap-3">
        {list.data?.items.map((p) => (
          <Card key={p.id} className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-base">{p.name}</span>
                  <Badge variant="outline" className="text-xs font-mono">
                    {p.id}
                  </Badge>
                </div>
                {p.description && <p className="text-sm text-muted-foreground mt-1">{p.description}</p>}
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mt-2">
                  <span>{p.providers.length} 个 Provider</span>
                  <span>{p.proxy_groups.length} 个策略组</span>
                  <span>{p.rule_modules.length} 个规则模块</span>
                  <span>{p.chain_rules.length} 条链式规则</span>
                  <span>{p.surge_modules.length} 个 Surge 模块</span>
                </div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <SubLinkButton profileId={p.id} target="clash" />
                  <SubLinkButton profileId={p.id} target="surge" />
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button asChild variant="outline" size="sm">
                  <Link to={`/profiles/${p.id}`}>
                    <Edit className="h-4 w-4" />
                    编辑
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={async () => {
                    if (!window.confirm(`删除 Profile "${p.name}"?`)) return;
                    await del.mutateAsync(p.id);
                    toast({ title: "已删除", variant: "success" });
                  }}
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
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

function randomToken(len: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-";
  let out = "";
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
