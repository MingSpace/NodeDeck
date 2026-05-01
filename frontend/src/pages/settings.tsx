import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ChangePasswordDialog } from "@/components/change-password-dialog";
import { useAuth } from "@/hooks/use-auth";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

interface AppConfigDto {
  admin_username: string;
  must_change_password: boolean;
  ip_allowlist: string[];
  public_base_url: string;
  default_user_agent: string;
}

export function SettingsPage() {
  const { username } = useAuth();
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="p-8 max-w-2xl space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">设置</h1>

      <Card>
        <CardHeader>
          <CardTitle>账户</CardTitle>
          <CardDescription>当前登录: {username ?? "-"}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => setPwOpen(true)}>
            修改密码
          </Button>
          {pwOpen && <ChangePasswordDialog forced={false} />}
        </CardContent>
      </Card>

      <ServiceConfigCard />

      <Card>
        <CardHeader>
          <CardTitle>关于</CardTitle>
          <CardDescription>MConvert v0.1.0</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <p>所有配置存储在 <code>data/</code> 目录,改完即生效,无需重启 docker 容器。</p>
        </CardContent>
      </Card>
    </div>
  );
}

function ServiceConfigCard() {
  const queryClient = useQueryClient();
  const cfgQuery = useQuery<AppConfigDto>({
    queryKey: ["config"],
    queryFn: () => api.get("/api/config"),
  });
  const [draft, setDraft] = useState<AppConfigDto | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (cfgQuery.data) {
      setDraft(JSON.parse(JSON.stringify(cfgQuery.data)));
      setDirty(false);
    }
  }, [cfgQuery.data]);

  const save = useMutation({
    mutationFn: (data: Partial<AppConfigDto>) => api.put("/api/config", data),
    onSuccess: () => {
      toast({ title: "已保存", variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["config"] });
      setDirty(false);
    },
    onError: (err) => toast({ title: "保存失败", description: String(err), variant: "error" }),
  });

  if (!draft) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>服务</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">加载中...</CardContent>
      </Card>
    );
  }

  const update = (patch: Partial<AppConfigDto>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };

  const onSave = () => {
    save.mutate({
      ip_allowlist: draft.ip_allowlist,
      public_base_url: draft.public_base_url,
      default_user_agent: draft.default_user_agent,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>服务</CardTitle>
        <CardDescription>影响订阅 URL、Provider 拉取与 Web UI 访问</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label className="text-xs">PUBLIC_BASE_URL</Label>
          <Input
            value={draft.public_base_url}
            onChange={(e) => update({ public_base_url: e.target.value })}
            placeholder="https://sub.example.com"
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            影响 Surge 的 #!MANAGED-CONFIG 头与 Web UI 显示的订阅 URL。留空则用请求 origin。
          </p>
        </div>

        <div>
          <Label className="text-xs">默认 User-Agent</Label>
          <Input
            value={draft.default_user_agent}
            onChange={(e) => update({ default_user_agent: e.target.value })}
            placeholder="Surge/2400"
            className="mt-1"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Provider 未指定 user_agent 时使用。
          </p>
        </div>

        <div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">IP 白名单 (CIDR)</Label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => update({ ip_allowlist: [...draft.ip_allowlist, ""] })}
              className="h-7"
            >
              <Plus className="h-3 w-3" />
              新增
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mt-1 mb-2">
            限制 /api/* 与 Web UI 访问。留空 = 放行所有 IP。订阅 URL 不受此限制。
          </p>
          {draft.ip_allowlist.length === 0 && (
            <div className="text-xs text-muted-foreground border border-dashed rounded p-3 text-center">
              空白名单 = 放行所有 IP
            </div>
          )}
          <div className="space-y-1.5">
            {draft.ip_allowlist.map((cidr, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input
                  value={cidr}
                  onChange={(e) => {
                    const next = draft.ip_allowlist.slice();
                    next[i] = e.target.value;
                    update({ ip_allowlist: next });
                  }}
                  placeholder="例如: 192.168.1.0/24 或 1.2.3.4/32"
                  className="text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => update({ ip_allowlist: draft.ip_allowlist.filter((_, idx) => idx !== i) })}
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={onSave} disabled={!dirty || save.isPending}>
            <Save className="h-4 w-4" />
            {save.isPending ? "保存中..." : "保存"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
