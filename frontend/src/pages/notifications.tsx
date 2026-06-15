import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Send, BellRing, CloudOff, PackageX, Gauge, ServerCrash, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEntityList } from "@/api/entities";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

// 与 backend/src/schemas/notification.ts 保持同步
type BarkLevel = "active" | "timeSensitive" | "critical" | "passive";

interface NotificationConfig {
  bark: {
    enabled: boolean;
    server: string;
    device_key: string;
    sound: string;
    group: string;
    level: BarkLevel;
  };
  events: {
    refresh_failure: { enabled: boolean; cooldown_hours: number };
    zero_nodes: { enabled: boolean };
    userinfo_alert: {
      enabled: boolean;
      provider_ids: string[] | null;
      expire_days: number;
      traffic_percent: number;
    };
    sub_error: { enabled: boolean };
    sub_warnings: { enabled: boolean };
  };
}

interface ProviderListItem {
  id: string;
  name: string;
  type: "http" | "file" | "inline";
  enabled: boolean;
}

const LEVEL_OPTIONS: { value: BarkLevel; label: string }[] = [
  { value: "active", label: "active(默认,亮屏显示)" },
  { value: "timeSensitive", label: "timeSensitive(专注模式可显示)" },
  { value: "critical", label: "critical(重要警告,无视静音)" },
  { value: "passive", label: "passive(仅加入通知列表)" },
];

export function NotificationsPage() {
  const queryClient = useQueryClient();
  const cfgQuery = useQuery<NotificationConfig>({
    queryKey: ["notification"],
    queryFn: () => api.get("/api/notification"),
  });
  const [draft, setDraft] = useState<NotificationConfig | null>(null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (cfgQuery.data) {
      setDraft(JSON.parse(JSON.stringify(cfgQuery.data)));
      setDirty(false);
    }
  }, [cfgQuery.data]);

  const save = useMutation({
    mutationFn: (data: NotificationConfig) => api.put("/api/notification", data),
    onSuccess: () => {
      toast({ title: "已保存", variant: "success" });
      queryClient.invalidateQueries({ queryKey: ["notification"] });
      setDirty(false);
    },
    onError: (err) => toast({ title: "保存失败", description: String(err), variant: "error" }),
  });

  const test = useMutation({
    // 带上当前草稿,未保存的配置也能直接测试
    mutationFn: () => api.post<{ ok: boolean; error?: string }>("/api/notification/test", draft),
    onSuccess: () => toast({ title: "测试推送已发送", description: "请查看 iPhone 上的 Bark 通知", variant: "success" }),
    onError: (err) => toast({ title: "测试推送失败", description: String(err), variant: "error" }),
  });

  if (!draft) {
    return (
      <div className="p-8 max-w-[1800px] mx-auto">
        <h1 className="text-2xl font-bold tracking-tight mb-4">通知</h1>
        <Card>
          <CardContent className="text-sm text-muted-foreground py-6">加载中...</CardContent>
        </Card>
      </div>
    );
  }

  const update = (patch: Partial<NotificationConfig>) => {
    setDraft({ ...draft, ...patch });
    setDirty(true);
  };
  const updateBark = (patch: Partial<NotificationConfig["bark"]>) =>
    update({ bark: { ...draft.bark, ...patch } });
  const updateEvents = (patch: Partial<NotificationConfig["events"]>) =>
    update({ events: { ...draft.events, ...patch } });

  return (
    <div className="p-8 max-w-[1800px] mx-auto space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">通知</h1>
          <p className="text-sm text-muted-foreground mt-1">
            通过 <a href="https://bark.day.app" target="_blank" rel="noreferrer" className="underline underline-offset-2">Bark</a> 推送节点源异常与订阅事件到 iPhone
          </p>
        </div>
        <Button onClick={() => save.mutate(draft)} disabled={!dirty || save.isPending}>
          <Save className="h-4 w-4" />
          {save.isPending ? "保存中..." : "保存"}
        </Button>
      </div>

      <div className="grid gap-4 items-start lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1.5">
              <CardTitle className="flex items-center gap-2">
                <BellRing className="h-5 w-5" />
                Bark 推送
              </CardTitle>
              <CardDescription>配置 Bark 服务器与设备;关闭总开关后所有通知静默</CardDescription>
            </div>
            <Switch
              checked={draft.bark.enabled}
              onCheckedChange={(v) => updateBark({ enabled: v })}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">服务器地址</Label>
              <Input
                value={draft.bark.server}
                onChange={(e) => updateBark({ server: e.target.value })}
                placeholder="https://api.day.app"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">Device Key</Label>
              <Input
                type="password"
                value={draft.bark.device_key}
                onChange={(e) => updateBark({ device_key: e.target.value })}
                placeholder="Bark App 中的设备 Key"
                className="mt-1"
                autoComplete="off"
              />
            </div>
            <div>
              <Label className="text-xs">分组(group)</Label>
              <Input
                value={draft.bark.group}
                onChange={(e) => updateBark({ group: e.target.value })}
                placeholder="NodeDeck"
                className="mt-1"
              />
            </div>
            <div>
              <Label className="text-xs">铃声(sound,留空用默认)</Label>
              <Input
                value={draft.bark.sound}
                onChange={(e) => updateBark({ sound: e.target.value })}
                placeholder="minuet"
                className="mt-1"
              />
            </div>
          </div>
          <div>
            <Label className="text-xs">中断级别(level)</Label>
            <Select
              value={draft.bark.level}
              onValueChange={(v) => updateBark({ level: v as BarkLevel })}
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVEL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end">
            <Button
              variant="outline"
              onClick={() => test.mutate()}
              disabled={!draft.bark.device_key || test.isPending}
            >
              <Send className="h-4 w-4" />
              {test.isPending ? "发送中..." : "发送测试推送"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>通知场景</CardTitle>
          <CardDescription>所有场景均可单独开关</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          <EventRow
            icon={CloudOff}
            title="节点源刷新失败"
            description="在线(http)节点源拉取失败时推送;恢复后再次失败会立即重推"
            checked={draft.events.refresh_failure.enabled}
            onCheckedChange={(v) =>
              updateEvents({ refresh_failure: { ...draft.events.refresh_failure, enabled: v } })
            }
          >
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground whitespace-nowrap">持续失败重推间隔</Label>
              <Input
                type="number"
                min={1}
                max={168}
                value={draft.events.refresh_failure.cooldown_hours}
                onChange={(e) =>
                  updateEvents({
                    refresh_failure: {
                      ...draft.events.refresh_failure,
                      cooldown_hours: clampNumber(e.target.value, 1, 168, 6),
                    },
                  })
                }
                className="w-20 h-8"
              />
              <span className="text-xs text-muted-foreground">小时</span>
            </div>
          </EventRow>

          <EventRow
            icon={PackageX}
            title="节点源解析为空"
            description="刷新成功但解析出 0 个节点(订阅可能失效或被机场按 UA 网关)"
            checked={draft.events.zero_nodes.enabled}
            onCheckedChange={(v) => updateEvents({ zero_nodes: { enabled: v } })}
          />

          <EventRow
            icon={Gauge}
            title="流量 / 到期预警"
            description="节点源刷新时检查 Subscription-UserInfo,跌破阈值后每 24 小时最多提醒一次"
            checked={draft.events.userinfo_alert.enabled}
            onCheckedChange={(v) =>
              updateEvents({ userinfo_alert: { ...draft.events.userinfo_alert, enabled: v } })
            }
          >
            <UserinfoAlertOptions
              value={draft.events.userinfo_alert}
              onChange={(next) => updateEvents({ userinfo_alert: next })}
            />
          </EventRow>

          <EventRow
            icon={ServerCrash}
            title="订阅生成失败"
            description="/sub 请求抛出异常(客户端拿到 5xx)时推送,按内容冷却 1 小时"
            checked={draft.events.sub_error.enabled}
            onCheckedChange={(v) => updateEvents({ sub_error: { enabled: v } })}
          />

          <EventRow
            icon={TriangleAlert}
            title="订阅生成警告"
            description="生成成功但出现 warnings(链式环 / 悬空引用 / 组引用剔除等),按内容冷却 1 小时"
            checked={draft.events.sub_warnings.enabled}
            onCheckedChange={(v) => updateEvents({ sub_warnings: { enabled: v } })}
          />
        </CardContent>
      </Card>
      </div>
    </div>
  );
}

function EventRow({
  icon: Icon,
  title,
  description,
  checked,
  onCheckedChange,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-md border p-3 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <div className="text-sm font-medium leading-tight">{title}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
          </div>
        </div>
        <Switch checked={checked} onCheckedChange={onCheckedChange} />
      </div>
      {checked && children && <div className="pl-7">{children}</div>}
    </div>
  );
}

function UserinfoAlertOptions({
  value,
  onChange,
}: {
  value: NotificationConfig["events"]["userinfo_alert"];
  onChange: (next: NotificationConfig["events"]["userinfo_alert"]) => void;
}) {
  const providersQuery = useEntityList<ProviderListItem>("providers");
  // 只有 http(在线)源才有 Subscription-UserInfo
  const httpProviders = (providersQuery.data?.items ?? []).filter((p) => p.type === "http");
  const allSelected = value.provider_ids === null;

  const toggleProvider = (id: string, checked: boolean) => {
    const current = value.provider_ids ?? httpProviders.map((p) => p.id);
    const next = checked ? [...new Set([...current, id])] : current.filter((x) => x !== id);
    onChange({ ...value, provider_ids: next });
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">到期前</Label>
          <Input
            type="number"
            min={0}
            max={60}
            value={value.expire_days}
            onChange={(e) => onChange({ ...value, expire_days: clampNumber(e.target.value, 0, 60, 3) })}
            className="w-20 h-8"
          />
          <span className="text-xs text-muted-foreground">天提醒</span>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground whitespace-nowrap">剩余流量低于</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={value.traffic_percent}
            onChange={(e) =>
              onChange({ ...value, traffic_percent: clampNumber(e.target.value, 0, 100, 5) })
            }
            className="w-20 h-8"
          />
          <span className="text-xs text-muted-foreground">% 提醒</span>
        </div>
      </div>

      <div className="space-y-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(v) =>
              onChange({ ...value, provider_ids: v === true ? null : httpProviders.map((p) => p.id) })
            }
          />
          <span className="text-xs font-medium">全部在线节点源</span>
        </label>
        {!allSelected && (
          <div className="space-y-1 border rounded-md p-2 max-h-48 overflow-y-auto">
            {httpProviders.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-2">
                暂无在线(http)节点源
              </div>
            )}
            {httpProviders.map((p) => (
              <label
                key={p.id}
                className="flex items-center gap-2 px-1.5 py-1 rounded hover:bg-muted/50 cursor-pointer"
              >
                <Checkbox
                  checked={(value.provider_ids ?? []).includes(p.id)}
                  onCheckedChange={(v) => toggleProvider(p.id, v === true)}
                />
                <span className="text-xs truncate">{p.name}</span>
                {!p.enabled && <span className="text-[10px] text-muted-foreground shrink-0">(已禁用)</span>}
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function clampNumber(raw: string, min: number, max: number, fallback: number): number {
  const n = Number(raw);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
