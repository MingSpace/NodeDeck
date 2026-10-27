import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, CircleCheck, CircleX, Copy, KeyRound, LoaderCircle, Pin, PlugZap } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/toast";

// 与 backend/src/schemas/egress.ts 保持同步
export interface EgressData {
  id: string;
  name: string;
  type: "ssh" | "proxy";
  host?: string;
  port?: number;
  username?: string;
  auth?: "key" | "password";
  password?: string;
  host_key?: string;
  url?: string;
  notes?: string;
}

// 与 backend/src/routes/egress-actions.ts EgressTestResult 保持同步
interface EgressTestResult {
  ok: boolean;
  error?: string;
  ip?: string;
  loc?: string;
  host_key?: string;
  duration_ms: number;
}

interface PublicKeyResponse {
  public_key: string;
  authorized_keys_line: string;
}

/** 列表 / 节点源里展示用的一句话地址:SSH 显示 user@host:port,代理去掉账号密码。 */
export function egressAddress(e: EgressData): string {
  if (e.type === "ssh") return `${e.username ?? "root"}@${e.host ?? "?"}${(e.port ?? 22) === 22 ? "" : `:${e.port}`}`;
  try {
    const u = new URL(e.url ?? "");
    return `${u.protocol}//${u.host}`;
  } catch {
    return e.url ?? "";
  }
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs" htmlFor={htmlFor}>
        {label}
      </Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{children}</p>;
}

export function EgressVisualForm({
  data,
  update,
}: {
  data: EgressData;
  update: (patch: Partial<EgressData>) => void;
}) {
  const auth = data.auth ?? "key";
  return (
    <div className="space-y-4">
      <Field label="名称" htmlFor="egress-name">
        <Input
          id="egress-name"
          value={data.name ?? ""}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="如 公司路由器 / 杭州阿里云"
        />
      </Field>

      <Tabs value={data.type} onValueChange={(v) => update({ type: v as EgressData["type"] })}>
        <TabsList>
          <TabsTrigger value="ssh">SSH 登录</TabsTrigger>
          <TabsTrigger value="proxy">现成代理</TabsTrigger>
        </TabsList>

        <TabsContent value="ssh" className="space-y-3 pt-3">
          <Hint>
            拉订阅时 NodeDeck 主动 SSH 过去,借这台机器的网络发请求,拉完即断开。对方只要开着 SSH、
            允许 TCP 转发,不用装任何东西,也没有常驻进程。
          </Hint>
          <div className="grid grid-cols-[minmax(0,1fr)_6rem_8rem] gap-3">
            <Field label="主机" htmlFor="egress-host">
              <Input
                id="egress-host"
                value={data.host ?? ""}
                onChange={(e) => update({ host: e.target.value })}
                placeholder="IP 或域名"
                className="font-mono text-xs"
                spellCheck={false}
              />
            </Field>
            <Field label="端口" htmlFor="egress-port">
              <Input
                id="egress-port"
                type="number"
                min={1}
                max={65535}
                value={data.port ?? 22}
                onChange={(e) => update({ port: Number(e.target.value) || undefined })}
                className="font-mono text-xs"
              />
            </Field>
            <Field label="用户" htmlFor="egress-user">
              <Input
                id="egress-user"
                value={data.username ?? "root"}
                onChange={(e) => update({ username: e.target.value })}
                className="font-mono text-xs"
                spellCheck={false}
              />
            </Field>
          </div>

          <div>
            <Label className="text-xs">登录方式</Label>
            <div className="mt-1 inline-flex rounded-md border p-0.5 bg-muted/40" role="radiogroup">
              {(
                [
                  ["key", "NodeDeck 密钥"],
                  ["password", "密码"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={auth === value}
                  onClick={() => update({ auth: value })}
                  className={cn(
                    "px-3 py-1 text-xs rounded transition-colors",
                    auth === value ? "bg-background shadow-sm font-medium" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {auth === "key" ? (
            <PublicKeyPanel />
          ) : (
            <Field label="密码" htmlFor="egress-password">
              <Input
                id="egress-password"
                type="password"
                autoComplete="new-password"
                value={data.password ?? ""}
                onChange={(e) => update({ password: e.target.value })}
              />
              <Hint>密码明文存在服务器的 data/egresses 里。能加公钥的机器优先用 NodeDeck 密钥。</Hint>
            </Field>
          )}

          <Field label="主机指纹(可选)" htmlFor="egress-hostkey">
            <Input
              id="egress-hostkey"
              value={data.host_key ?? ""}
              onChange={(e) => update({ host_key: e.target.value || undefined })}
              placeholder="SHA256:… 留空不校验;测试连接后可一键固定"
              className="font-mono text-xs"
              spellCheck={false}
            />
          </Field>
        </TabsContent>

        <TabsContent value="proxy" className="space-y-3 pt-3">
          <Field label="代理地址" htmlFor="egress-url">
            <Input
              id="egress-url"
              value={data.url ?? ""}
              onChange={(e) => update({ url: e.target.value })}
              placeholder="socks5://172.18.0.1:18888"
              className="font-mono text-xs"
              spellCheck={false}
            />
            <Hint>
              已经有可用的 <span className="font-mono">http://</span> / <span className="font-mono">https://</span> /{" "}
              <span className="font-mono">socks5://</span> 代理时用,可带账号密码。连不进去的机器(如家里内网)
              可以自己建反向隧道再填这里,见部署文档。
            </Hint>
          </Field>
        </TabsContent>
      </Tabs>

      <EgressTest data={data} update={update} />

      <Field label="备注" htmlFor="egress-notes">
        <Textarea
          id="egress-notes"
          value={data.notes ?? ""}
          onChange={(e) => update({ notes: e.target.value || undefined })}
          className="min-h-[60px] text-xs"
        />
      </Field>
    </div>
  );
}

function PublicKeyPanel() {
  const key = useQuery({
    queryKey: ["egresses", "public-key"],
    queryFn: () => api.get<PublicKeyResponse>("/api/egresses/public-key"),
    staleTime: Infinity,
  });
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!key.data) return;
    try {
      await navigator.clipboard.writeText(key.data.authorized_keys_line);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      toast({ title: "复制失败", description: String(err), variant: "error" });
    }
  };
  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium">
        <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
        把这一行加到出口机的 authorized_keys
        <Button type="button" variant="outline" size="sm" className="ml-auto h-7" disabled={!key.data} onClick={copy}>
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "已复制" : "复制"}
        </Button>
      </div>
      <code className="block font-mono text-[11px] leading-relaxed break-all text-muted-foreground select-all">
        {key.data?.authorized_keys_line ?? (key.error ? `读取公钥失败:${(key.error as Error).message}` : "加载中…")}
      </code>
      <Hint>
        Linux 一般是 <span className="font-mono">~/.ssh/authorized_keys</span>,OpenWrt 路由器是{" "}
        <span className="font-mono">/etc/dropbear/authorized_keys</span>。前缀限制这把钥匙只能转发端口,登录不了 shell。
      </Hint>
    </div>
  );
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

function EgressTest({ data, update }: { data: EgressData; update: (patch: Partial<EgressData>) => void }) {
  const test = useMutation({
    mutationFn: (input: EgressData) => api.post<EgressTestResult>("/api/egresses/test", input),
  });
  const r = test.data;
  const canPin = data.type === "ssh" && r?.host_key && r.host_key !== data.host_key;

  return (
    <div>
      <Button type="button" variant="outline" disabled={test.isPending} onClick={() => test.mutate(data)}>
        {test.isPending ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <PlugZap className="h-3.5 w-3.5" />}
        测试连接
      </Button>
      {(test.isPending || r || test.error) && (
        <div className="mt-2 rounded-md border bg-muted/30 p-2.5 text-xs space-y-1.5" aria-live="polite">
          {test.isPending && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              正在经这个出口访问外网…
            </div>
          )}
          {test.error && <div className="text-destructive">{(test.error as Error).message}</div>}
          {r && !test.isPending && (
            <>
              <div className="flex items-start gap-2">
                {r.ok ? (
                  <CircleCheck className="h-3.5 w-3.5 mt-px shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="成功" />
                ) : (
                  <CircleX className="h-3.5 w-3.5 mt-px shrink-0 text-destructive" aria-label="失败" />
                )}
                {r.ok ? (
                  <span>
                    出口 IP <span className="font-mono">{r.ip}</span>
                    {r.loc && <span className="ml-1.5 rounded bg-muted px-1 font-mono">{r.loc}</span>}
                  </span>
                ) : (
                  <span className="text-destructive break-words">{r.error}</span>
                )}
                <span className="ml-auto tabular-nums text-muted-foreground">{formatDuration(r.duration_ms)}</span>
              </div>
              {r.host_key && (
                <div className="flex items-center gap-2 pl-[1.375rem] text-muted-foreground">
                  <span className="truncate">
                    主机指纹 <span className="font-mono">{r.host_key}</span>
                  </span>
                  {canPin ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 ml-auto shrink-0"
                      onClick={() => update({ host_key: r.host_key })}
                    >
                      <Pin className="h-3 w-3" />
                      固定
                    </Button>
                  ) : (
                    data.host_key && <span className="ml-auto shrink-0 text-emerald-600 dark:text-emerald-400">已固定</span>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
