import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Upload } from "lucide-react";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/components/ui/toast";
import { HostRowsEditor } from "@/components/host-rows-editor";

export type ProviderType = "http" | "file" | "inline";

export type ParserHint =
  | "auto"
  | "clash"
  | "surge"
  | "v2ray_base64"
  | "ss_links"
  | "trojan_links"
  | "hysteria2_links"
  | "mixed";

export type RefreshInterval =
  | "never"
  | "4h"
  | "12h"
  | "24h"
  | "1week"
  | "on_request";

export interface ProviderRefresh {
  interval: RefreshInterval;
}

export interface ClashProxyProvider {
  enabled: boolean;
  health_check_url: string;
  health_check_interval: number;
}

export interface ProviderData {
  id: string;
  name: string;
  type: ProviderType;
  url?: string;
  path?: string;
  content?: string;
  user_agent: string;
  refresh: ProviderRefresh;
  parser_hint: ParserHint;
  enabled: boolean;
  tags: string[];
  notes?: string;
  clash_proxy_provider: ClashProxyProvider;
  // 针对该节点源的 DNS 解析覆盖;emit_hosts 控制订阅输出时是否自动带出(默认带出)。
  hosts?: Record<string, string | string[]>;
  emit_hosts?: boolean;
}

export const DEFAULT_PROVIDER_TEMPLATE: Partial<ProviderData> = {
  name: "new provider",
  type: "http",
  url: "https://example.com/subscribe?token=xxx",
  user_agent: "",
  refresh: { interval: "12h" },
  parser_hint: "auto",
  enabled: true,
  tags: [],
  clash_proxy_provider: {
    enabled: false,
    health_check_url: "http://www.gstatic.com/generate_204",
    health_check_interval: 300,
  },
  emit_hosts: true,
};

// 静态节点(inline)默认模板:供 ?new=inline 等深度链接预填表单。
// 与 DEFAULT_PROVIDER_TEMPLATE 区别仅在 type / 没有 url / 给一个空 content。
export const INLINE_PROVIDER_TEMPLATE: Partial<ProviderData> = {
  name: "static nodes",
  type: "inline",
  content: "",
  user_agent: "",
  refresh: { interval: "12h" },
  parser_hint: "auto",
  enabled: true,
  tags: [],
  clash_proxy_provider: {
    enabled: false,
    health_check_url: "http://www.gstatic.com/generate_204",
    health_check_interval: 300,
  },
  emit_hosts: true,
};

const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

type HostMap = Record<string, string | string[]>;

interface ExtractedHostsResp {
  count: number;
  fetched_at?: number;
  hosts: HostMap;
}

// 把 host map 摊平成 [key, value] 行(同 key 多值各占一行),用于只读预览。
function flattenHostRows(map: HostMap | undefined): Array<{ key: string; value: string }> {
  if (!map) return [];
  const rows: Array<{ key: string; value: string }> = [];
  for (const [key, v] of Object.entries(map)) {
    for (const value of Array.isArray(v) ? v : [v]) rows.push({ key, value });
  }
  return rows;
}

interface Props {
  data: ProviderData;
  update: (patch: Partial<ProviderData>) => void;
  isNew?: boolean;
}

export function ProviderVisualForm({ data, update, isNew }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const refresh = data.refresh ?? { interval: "12h" };
  const cpp =
    data.clash_proxy_provider ?? {
      enabled: false,
      health_check_url: "http://www.gstatic.com/generate_204",
      health_check_interval: 300,
    };
  const tabValue =
    data.type === "http" ? "http" : data.type === "inline" ? "inline" : "";

  // 该节点源上游自带、刷新时自动解析到的 hosts(只读预览)。emit_hosts 开启时这些会随订阅自动带出。
  // 仅对已保存的源查询(新建源还没 cache);切到 YAML 模式或刷新后自动重取。
  const autoHostsQuery = useQuery<ExtractedHostsResp>({
    queryKey: ["providers", data.id, "extracted-hosts"],
    queryFn: () => api.get(`/api/providers/${data.id}/extracted-hosts`),
    enabled: !isNew && !!data.id,
    staleTime: 30_000,
  });
  const autoHostRows = flattenHostRows(autoHostsQuery.data?.hosts);

  // @business_rule: tab 切换只改 type,另一边字段(url / content)保留为"草稿"。
  // 之前主动把对侧字段置 undefined 会让用户在 URL 订阅 / 静态节点之间来回切换时丢内容,
  // 例如在静态节点粘了大段 content → 切到 URL 订阅 → 切回静态节点,content 就空了。
  // 后端 providerSchema.superRefine 只校验当前 type 所需字段,另一侧冗余字段不会让保存失败。
  // file 类型独占的 path 仍然清掉:tabs 里没有 file 入口,切走视为"自动迁移"(顶部 warning 已说明)。
  const switchTo = (next: ProviderType) => {
    if (next === "http") {
      update({
        type: "http",
        url: data.url ?? "",
        user_agent: data.user_agent ?? "",
        path: undefined,
      });
    } else {
      update({
        type: "inline",
        content: data.content ?? "",
        path: undefined,
      });
    }
  };

  const onFileChosen = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      toast({
        title: "文件过大",
        description: `${(file.size / 1024 / 1024).toFixed(1)}MB > 5MB,请改用 URL 订阅方式`,
        variant: "error",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? "");
      update({ content: text });
      toast({
        title: "已读取文件",
        description: `${file.name} (${text.length.toLocaleString()} 字符)`,
        variant: "success",
      });
    };
    reader.onerror = () =>
      toast({
        title: "读取失败",
        description: String(reader.error ?? ""),
        variant: "error",
      });
    reader.readAsText(file);
  };

  const tagsText = (data.tags ?? []).join(", ");

  // 各折叠模块「有数据则默认展开」的判定:让用户一打开节点源就看到已配置的内容,无需逐个点开。
  const hasClashProvider = cpp.enabled === true;
  // 手动追加的 host 或上游自动解析到的 host 任一非空,都算"有数据"展开;
  // 只看手动 hosts 会让自动解析条目被折叠藏起来(emit_hosts 开着却看不到带出了什么)。
  const hasHosts =
    (!!data.hosts && Object.keys(data.hosts).length > 0) ||
    autoHostRows.length > 0;
  const hasTagsOrNotes =
    (data.tags?.length ?? 0) > 0 || !!data.notes?.trim();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="ID (文件名,字母数字下划线)">
          <Input
            value={data.id}
            disabled={!isNew}
            onChange={(e) => update({ id: e.target.value })}
            placeholder="provider-xxxx"
          />
        </Field>
        <Field label="显示名">
          <Input
            value={data.name}
            onChange={(e) => update({ name: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex items-center gap-2">
        <Switch
          checked={data.enabled !== false}
          onCheckedChange={(v) => update({ enabled: v })}
        />
        <Label className="text-sm">启用 (禁用后不会被刷新与拉取)</Label>
      </div>

      {data.type === "file" && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-200">
          此节点源使用「服务器本地路径」
          <code className="px-1 font-mono">{data.path ?? ""}</code>
          。可视化模式不直接编辑 path,如需保留请切到「YAML 高级」;
          或在下方选择 URL / 静态方式将自动迁移。
        </div>
      )}

      <Tabs value={tabValue} onValueChange={(v) => switchTo(v as ProviderType)}>
        <TabsList>
          <TabsTrigger value="http">URL 订阅</TabsTrigger>
          <TabsTrigger value="inline">静态节点</TabsTrigger>
        </TabsList>
        <TabsContent value="http" className="space-y-3 pt-3">
          <Field label="URL">
            <Input
              type="url"
              value={data.url ?? ""}
              onChange={(e) => update({ url: e.target.value })}
              placeholder="https://example.com/subscribe?token=xxx"
            />
          </Field>
          <Field label="User-Agent (部分机场按 UA 返回不同格式)">
            <Input
              value={data.user_agent ?? ""}
              onChange={(e) => update({ user_agent: e.target.value })}
              placeholder="留空 = 自动尝试多种 UA"
            />
            <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
              留空即可。机场常按 UA 网关:某些 UA(尤其 Surge 系)会返回 200 但空 body,
              此时后端会自动换 clash-verge / mihomo 等 UA 重试,直到拿到内容。需要钉死某个 UA 再手动填。
            </p>
          </Field>
        </TabsContent>
        <TabsContent value="inline" className="space-y-2 pt-3">
          <Field label="节点文本">
            <Textarea
              value={data.content ?? ""}
              onChange={(e) => update({ content: e.target.value })}
              className="min-h-[200px] font-mono text-xs"
              placeholder={
                "支持以下任一格式 (auto 解析器自动识别):\n" +
                "- Clash YAML: 含 proxies: 数组,每项须有 name / type / server / port\n" +
                "- Surge .conf (含 [Proxy] 段) 或裸 Surge 行 (如 `name = trojan, host, port, ...`)\n" +
                "- URI: 一行一个 ss:// vmess:// vless:// trojan:// hysteria2:// tuic:// socks5://\n" +
                "- v2ray base64: base64 编码的 URI 列表 (auto 自动解码)\n" +
                "提示: 想混贴 URI + Surge 行,把下方 parser_hint 切到 mixed; direct 节点会被自动跳过"
              }
            />
          </Field>
          <div className="flex items-center gap-3 text-xs">
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept=".yaml,.yml,.conf,.txt,.list,.b64,.sub"
              onChange={onFileChosen}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-3.5 w-3.5" />
              从文件导入
            </Button>
            <span className="text-muted-foreground">
              选择本地文件,内容会替换上方文本(限制 5MB)
            </span>
          </div>
        </TabsContent>
      </Tabs>

      <Field label="解析器提示 (auto 通常足够;命中错误时可手动指定)">
        <Select
          value={data.parser_hint ?? "auto"}
          onValueChange={(v) => update({ parser_hint: v as ParserHint })}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">auto (自动识别)</SelectItem>
            <SelectItem value="clash">clash (YAML)</SelectItem>
            <SelectItem value="surge">surge (.conf)</SelectItem>
            <SelectItem value="v2ray_base64">v2ray_base64</SelectItem>
            <SelectItem value="ss_links">ss_links (多行 ss://)</SelectItem>
            <SelectItem value="trojan_links">
              trojan_links (多行 trojan://)
            </SelectItem>
            <SelectItem value="hysteria2_links">
              hysteria2_links (多行 hysteria2://)
            </SelectItem>
            <SelectItem value="mixed">
              mixed (URI + Surge 行混贴,逐行解析)
            </SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {data.type !== "inline" && (
        <CollapsibleSection title="刷新策略" autoOpen>
          <Field label="刷新周期">
            <Select
              value={refresh.interval}
              onValueChange={(v) =>
                update({ refresh: { interval: v as RefreshInterval } })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="4h">每 4 小时</SelectItem>
                <SelectItem value="12h">每 12 小时</SelectItem>
                <SelectItem value="24h">每 24 小时</SelectItem>
                <SelectItem value="1week">每 1 周</SelectItem>
                <SelectItem value="on_request">
                  每次调用时(实时拉取)
                </SelectItem>
                <SelectItem value="never">
                  手动刷新(不自动调度,需要时点列表里的刷新按钮)
                </SelectItem>
              </SelectContent>
            </Select>
            {refresh.interval === "never" && (
              <p className="text-xs text-muted-foreground mt-1">
                后台不再按周期拉取;首次会自动拉一次种子,之后仅在你点列表里的刷新按钮 / 「刷新全部」时才会更新。
              </p>
            )}
            {refresh.interval === "on_request" && (
              <p className="text-xs text-muted-foreground mt-1">
                每次访问 /sub 都会同步去机场拉取,响应耗时取决于机场。
              </p>
            )}
          </Field>
        </CollapsibleSection>
      )}

      <CollapsibleSection title="Clash proxy-providers 暴露 (mihomo)" autoOpen={hasClashProvider}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={cpp.enabled}
              onCheckedChange={(v) =>
                update({ clash_proxy_provider: { ...cpp, enabled: v } })
              }
            />
            <Label className="text-xs">
              启用后主订阅顶部会写出{" "}
              <code className="font-mono">proxy-providers:</code> 段
            </Label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="健康检查 URL">
              <Input
                value={cpp.health_check_url}
                onChange={(e) =>
                  update({
                    clash_proxy_provider: {
                      ...cpp,
                      health_check_url: e.target.value,
                    },
                  })
                }
                placeholder="http://www.gstatic.com/generate_204"
              />
            </Field>
            <Field label="健康检查间隔 (秒, 60-86400)">
              <Input
                type="number"
                min={60}
                max={86400}
                value={cpp.health_check_interval}
                onChange={(e) =>
                  update({
                    clash_proxy_provider: {
                      ...cpp,
                      health_check_interval: Math.max(
                        60,
                        Math.min(
                          86400,
                          parseInt(e.target.value || "300", 10) || 300,
                        ),
                      ),
                    },
                  })
                }
              />
            </Field>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="节点源 Host (DNS 解析覆盖)" autoOpen={hasHosts}>
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Switch
              checked={data.emit_hosts !== false}
              onCheckedChange={(v) => update({ emit_hosts: v })}
            />
            <Label className="text-xs">
              生成订阅时自动带出以下 host (关闭则不输出此源的 host)
            </Label>
          </div>

          {!isNew && (
            <div className="rounded-md border bg-muted/30 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">自动从订阅解析到的 host</span>
                <span className="text-[11px] text-muted-foreground">
                  {data.emit_hosts !== false ? "随订阅自动带出 · 每次刷新更新" : "emit_hosts 已关闭,不带出"}
                </span>
              </div>
              {autoHostsQuery.isLoading ? (
                <div className="text-[11px] text-muted-foreground">加载中…</div>
              ) : autoHostRows.length === 0 ? (
                <div className="text-[11px] text-muted-foreground">
                  未从该订阅解析到 host(上游配置无 Clash <span className="font-mono">hosts:</span> / Surge{" "}
                  <span className="font-mono">[Host]</span> 段;刷新后仍为空则确属没有)
                </div>
              ) : (
                <div className="space-y-0.5">
                  {autoHostRows.map((r, i) => (
                    <div key={i} className="flex gap-2 text-[11px] font-mono">
                      <span className="shrink-0 max-w-[40%] truncate" title={r.key}>
                        {r.key}
                      </span>
                      <span className="text-muted-foreground">=</span>
                      <span className="truncate text-muted-foreground" title={r.value}>
                        {r.value}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="text-[11px] text-muted-foreground">
            下面是额外手动追加的 host(与上面自动解析到的一并去重带出),一般无需填写:
          </div>
          <HostRowsEditor
            value={data.hosts}
            onChange={(hosts) => update({ hosts })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="标签 / 备注" autoOpen={hasTagsOrNotes}>
        <div className="space-y-3">
          <Field label="Tags (逗号分隔)">
            <Input
              value={tagsText}
              onChange={(e) =>
                update({
                  tags: e.target.value
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="cn, premium, foo"
            />
          </Field>
          <Field label="备注">
            <Textarea
              value={data.notes ?? ""}
              onChange={(e) =>
                update({ notes: e.target.value || undefined })
              }
              className="min-h-[60px]"
              placeholder="(可选) 仅自己看的说明,不会暴露给客户端"
            />
          </Field>
        </div>
      </CollapsibleSection>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function CollapsibleSection({
  title,
  autoOpen,
  children,
}: {
  title: string;
  // 该模块当前是否"有数据"。由无变有(或切换节点源后修正初始挂载时的陈旧判断)时自动展开,
  // 由有变无时收起;autoOpen 不变则不干预,用户手动开合得以保留。
  autoOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(!!autoOpen);
  useEffect(() => {
    setOpen(!!autoOpen);
  }, [autoOpen]);
  return (
    <details
      open={open}
      onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}
      className="border rounded-md"
    >
      <summary className="px-3 py-2 cursor-pointer text-sm font-medium bg-muted/30 hover:bg-muted/50 rounded-md">
        {title}
      </summary>
      <div className="p-3 border-t">{children}</div>
    </details>
  );
}
