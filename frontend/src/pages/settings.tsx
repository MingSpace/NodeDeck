import { useEffect, useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Save, Plus, Trash2, AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
    <div className="p-8 max-w-[1800px] mx-auto space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">设置</h1>

      <div className="grid gap-4 items-start lg:grid-cols-2">
        <ServiceConfigCard />

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>账户</CardTitle>
              <CardDescription>当前登录: {username ?? "-"}</CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={() => setPwOpen(true)}>
                修改密码
              </Button>
              <ChangePasswordDialog forced={false} open={pwOpen} onOpenChange={setPwOpen} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>关于</CardTitle>
              <CardDescription>NodeDeck v1.0.0</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-1">
              <p>所有配置存储在 <code>data/</code> 目录,改完即生效,无需重启 docker 容器。</p>
            </CardContent>
          </Card>

          <DangerZoneCard />
        </div>
      </div>
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
    // 空行是「新增」点出来但没填的占位,原样提交会变成一条永远匹配不上的白名单规则,
    // 直接把自己挡在所有 /api/* 外面(设置页也救不回来),所以提交前先剔除。
    const allowlist = draft.ip_allowlist.map((entry) => entry.trim()).filter(Boolean);
    update({ ip_allowlist: allowlist });
    save.mutate({
      ip_allowlist: allowlist,
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
            限制 /api/* 与 Web UI 访问。留空 = 放行所有 IP(空白行保存时会被忽略)。订阅 URL 不受此限制。
          </p>
          <p className="text-xs text-amber-600 mb-2">
            填错会导致登录后所有接口 403,且设置页本身也被挡住,只能改服务器上的 data/config.yaml 才能恢复。
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

// @business_rule 还原范围细分到每一类资源,默认全选,管理员账号不在选项里(永远不会被删)。
// @business_rule 任何一项与文件落盘强相关,确认操作不可撤销,因此走"输入 RESET 二次确认"流程。
interface ResetScope {
  providers: boolean;
  rules: boolean;
  groups: boolean;
  modules: boolean;
  general: boolean;
  profiles: boolean;
  cache: boolean;
  service_settings: boolean;
}

interface ResetOption {
  key: keyof ResetScope;
  label: string;
  description: string;
}

const RESET_OPTIONS: ResetOption[] = [
  { key: "providers", label: "节点源 (Providers)", description: "所有机场订阅 / 静态节点" },
  { key: "cache", label: "Provider 缓存", description: "已拉取的节点 + 流量信息(随节点源一并清除)" },
  { key: "rules", label: "规则模块 (Rules)", description: "所有 ruleset 配置" },
  { key: "groups", label: "策略组 (Groups)", description: "所有 proxy-group 配置" },
  { key: "modules", label: "Surge 模块", description: "所有 Surge module 配置" },
  { key: "general", label: "通用预设", description: "所有 general preset 配置" },
  { key: "profiles", label: "订阅配置文件 (Profiles)", description: "所有 Profile 及对应的订阅 token" },
  { key: "service_settings", label: "服务设置", description: "IP 白名单 / PUBLIC_BASE_URL / 默认 User-Agent" },
];

function defaultScope(checked = true): ResetScope {
  return {
    providers: checked,
    rules: checked,
    groups: checked,
    modules: checked,
    general: checked,
    profiles: checked,
    cache: checked,
    service_settings: checked,
  };
}

function DangerZoneCard() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            危险区域
          </CardTitle>
          <CardDescription>
            还原所有数据配置 — 删除节点源 / 规则 / 策略组 / Surge 模块 / 通用预设 / 订阅配置 / 服务设置等。
            <span className="block mt-1 text-foreground font-medium">管理员账号和密码不会被影响。</span>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={() => setOpen(true)}>
            <RotateCcw className="h-4 w-4" />
            还原数据配置
          </Button>
        </CardContent>
      </Card>
      {open && <ResetDialog open={open} onOpenChange={setOpen} />}
    </>
  );
}

function ResetDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<ResetScope>(() => defaultScope(true));
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  // @user_flow 弹窗每次打开都重置状态,避免上次的输入残留导致一键提交。
  useEffect(() => {
    if (open) {
      setScope(defaultScope(true));
      setConfirmation("");
      setError(null);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; removed: Record<string, number | boolean> }>("/api/config/reset", {
        confirmation,
        scope,
      }),
    onSuccess: (data) => {
      const removed = data.removed;
      const summary = Object.entries(removed)
        .filter(([, v]) => (typeof v === "number" ? v > 0 : v === true))
        .map(([k, v]) => (typeof v === "boolean" ? labelOf(k as keyof ResetScope) : `${labelOf(k as keyof ResetScope)} ×${v}`))
        .join(" / ");
      toast({
        title: "还原完成",
        description: summary || "未删除任何文件",
        variant: "success",
      });
      // 全量失效,所有列表/详情都重新拉
      void queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (err: Error) => setError(err.message),
  });

  const selectedCount = Object.values(scope).filter(Boolean).length;
  const canSubmit = selectedCount > 0 && confirmation === "RESET" && !mutation.isPending;

  // providers 与 cache 强联动:勾 providers 自动勾 cache(后端也会兜底,这里只是 UI 提示)
  const toggle = (key: keyof ResetScope, checked: boolean) => {
    setScope((s) => {
      const next = { ...s, [key]: checked };
      if (key === "providers" && checked) next.cache = true;
      return next;
    });
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-destructive flex items-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            还原数据配置
          </DialogTitle>
          <DialogDescription>
            选择需要还原(清空)的数据范围。此操作不可撤销,请谨慎操作。
            <br />
            <span className="text-foreground font-medium">管理员账号和密码不会被影响。</span>
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1 rounded-md border p-3">
            <div className="flex items-center justify-between pb-2 border-b">
              <span className="text-xs text-muted-foreground">已选 {selectedCount} 项</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScope(defaultScope(true))}
                  className="text-xs text-primary hover:underline"
                >
                  全选
                </button>
                <span className="text-xs text-muted-foreground">|</span>
                <button
                  type="button"
                  onClick={() => setScope(defaultScope(false))}
                  className="text-xs text-primary hover:underline"
                >
                  全不选
                </button>
              </div>
            </div>
            {RESET_OPTIONS.map((opt) => {
              const isChecked = scope[opt.key];
              const linkedToProviders = opt.key === "cache" && scope.providers;
              return (
                <label
                  key={opt.key}
                  className="flex items-start gap-3 px-2 py-1.5 rounded hover:bg-muted/50 cursor-pointer"
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={(v) => toggle(opt.key, v === true)}
                    disabled={linkedToProviders}
                    className="mt-0.5"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium leading-tight">{opt.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {opt.description}
                      {linkedToProviders && (
                        <span className="text-amber-600 ml-1">(已随节点源勾选)</span>
                      )}
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-reset" className="text-xs">
              请输入 <code className="px-1 py-0.5 rounded bg-muted text-destructive font-mono">RESET</code> 以确认
            </Label>
            <Input
              id="confirm-reset"
              autoComplete="off"
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="RESET"
              className="font-mono"
            />
          </div>

          {error && <div className="text-sm text-destructive bg-destructive/10 rounded p-2">{error}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              取消
            </Button>
            <Button type="submit" variant="destructive" disabled={!canSubmit}>
              <RotateCcw className="h-4 w-4" />
              {mutation.isPending ? "还原中..." : "确认还原"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function labelOf(key: keyof ResetScope): string {
  return RESET_OPTIONS.find((o) => o.key === key)?.label ?? key;
}
