import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import yaml from "js-yaml";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { YamlEditor } from "./yaml-editor";
import { api } from "@/lib/api";
import { toast } from "@/components/ui/toast";

const NODE_TYPES = [
  "ss",
  "ssr",
  "vmess",
  "vless",
  "trojan",
  "hysteria2",
  "tuic",
  "wireguard",
  "snell",
  "anytls",
  "socks5",
  "http",
  "https",
  "direct",
] as const;
type NodeType = (typeof NODE_TYPES)[number];

const NETWORK_TYPES = ["tcp", "udp", "ws", "grpc", "h2", "http"] as const;
type NetworkType = (typeof NETWORK_TYPES)[number];

// ManualNode 是宽松类型: 可视化只覆盖核心字段, 其它协议字段(reality_opts/wg peers/plugin_opts 等)
// 通过 [key: string]: unknown 透传, 在 YAML tab 编辑时保留。
interface ManualNode {
  name: string;
  type: NodeType;
  server: string;
  port: number;
  password?: string;
  uuid?: string;
  cipher?: string;
  tls?: boolean;
  sni?: string;
  skip_cert_verify?: boolean;
  network?: NetworkType;
  ws_opts?: { path?: string; headers?: Record<string, string> };
  udp?: boolean;
  tfo?: boolean;
  tags?: string[];
  [key: string]: unknown;
}

interface ManualNodes {
  nodes: ManualNode[];
}

interface ManualNodeDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  mode: "create" | "edit";
  /** 编辑模式下用于在 nodes[] 中定位被改的节点 */
  originalName?: string;
}

const EMPTY_NODE: ManualNode = {
  name: "new-node",
  type: "ss",
  server: "example.com",
  port: 443,
};

type Tab = "visual" | "yaml";

export function ManualNodeDialog({ open, onOpenChange, mode, originalName }: ManualNodeDialogProps) {
  const queryClient = useQueryClient();
  const [data, setData] = useState<ManualNode | null>(null);
  const [yamlText, setYamlText] = useState("");
  const [tab, setTab] = useState<Tab>("visual");
  const [error, setError] = useState<string | null>(null);

  const manual = useQuery<ManualNodes>({
    queryKey: ["entities", "manual-nodes"],
    queryFn: () => api.get("/api/entities/manual-nodes"),
    enabled: open,
  });

  const save = useMutation({
    mutationFn: (next: ManualNodes) => api.put("/api/entities/manual-nodes", next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["entities", "manual-nodes"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard", "node-pool"] });
      toast({ title: "已保存", variant: "success" });
      onOpenChange(false);
    },
    onError: (err) => setError(err instanceof Error ? err.message : String(err)),
  });

  useEffect(() => {
    if (!open) return;
    if (!manual.data) return;
    let initial: ManualNode;
    if (mode === "edit" && originalName) {
      const found = manual.data.nodes.find((n) => n.name === originalName);
      initial = found ? (JSON.parse(JSON.stringify(found)) as ManualNode) : { ...EMPTY_NODE };
    } else {
      initial = { ...EMPTY_NODE };
    }
    setData(initial);
    setYamlText(yaml.dump(initial, { sortKeys: false, lineWidth: 200 }));
    setTab("visual");
    setError(null);
  }, [open, manual.data, mode, originalName]);

  const update = (patch: Partial<ManualNode>) => {
    setData((prev) => (prev ? { ...prev, ...patch } : prev));
  };

  const switchTab = (next: Tab) => {
    if (tab === next) return;
    if (tab === "visual" && next === "yaml" && data) {
      setYamlText(yaml.dump(data, { sortKeys: false, lineWidth: 200 }));
    } else if (tab === "yaml" && next === "visual") {
      try {
        const parsed = yaml.load(yamlText);
        if (!parsed || typeof parsed !== "object") {
          setError("YAML 非对象");
          return;
        }
        setData(parsed as ManualNode);
        setError(null);
      } catch (err) {
        setError("YAML 解析失败: " + (err as Error).message);
        return;
      }
    }
    setTab(next);
  };

  const handleSave = () => {
    setError(null);
    let target: ManualNode | null = data;
    if (tab === "yaml") {
      try {
        target = yaml.load(yamlText) as ManualNode;
      } catch (err) {
        setError("YAML 格式错误: " + (err as Error).message);
        return;
      }
    }
    if (!target || typeof target !== "object") {
      setError("YAML 非对象");
      return;
    }
    if (!target.name || !target.type) {
      setError("缺少必填字段 name 或 type");
      return;
    }
    if (!target.server || !target.port) {
      setError("缺少必填字段 server 或 port");
      return;
    }

    const all = manual.data?.nodes ?? [];
    let nextNodes: ManualNode[];
    if (mode === "edit" && originalName) {
      const idx = all.findIndex((n) => n.name === originalName);
      if (idx === -1) {
        setError(`未找到原节点 ${originalName}`);
        return;
      }
      // 重命名时检查冲突
      if (target.name !== originalName && all.some((n, i) => i !== idx && n.name === target!.name)) {
        setError(`已存在同名节点: ${target.name}`);
        return;
      }
      nextNodes = [...all];
      nextNodes[idx] = target;
    } else {
      if (all.some((n) => n.name === target!.name)) {
        setError(`已存在同名节点: ${target.name}`);
        return;
      }
      nextNodes = [...all, target];
    }
    save.mutate({ nodes: nextNodes });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl h-[85vh] flex flex-col gap-4">
        <DialogHeader>
          <DialogTitle>{mode === "edit" ? `编辑节点 ${originalName ?? ""}` : "新建手动节点"}</DialogTitle>
          <DialogDescription>
            可视化只覆盖核心字段,YAML 高级 tab 支持完整 schema (reality_opts / wg peers / plugin_opts 等)。
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => switchTab(v as Tab)} className="flex-1 min-h-0 flex flex-col">
          <TabsList className="self-start">
            <TabsTrigger value="visual">可视化</TabsTrigger>
            <TabsTrigger value="yaml">YAML 高级</TabsTrigger>
          </TabsList>
          <TabsContent value="visual" className="flex-1 min-h-0 overflow-auto px-1 pb-1">
            {data ? (
              <VisualForm data={data} update={update} />
            ) : (
              <div className="text-sm text-muted-foreground p-6">加载中...</div>
            )}
          </TabsContent>
          <TabsContent value="yaml" className="flex-1 min-h-0">
            <YamlEditor value={yamlText} onChange={setYamlText} height="100%" />
          </TabsContent>
        </Tabs>

        {error && (
          <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2 whitespace-pre-wrap">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={save.isPending || manual.isLoading}>
            {save.isPending ? "保存中..." : "保存"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TYPES_NEED_PASSWORD = new Set<NodeType>(["ss", "trojan", "hysteria2", "anytls", "snell"]);
const TYPES_NEED_UUID = new Set<NodeType>(["vmess", "vless", "tuic"]);

function VisualForm({
  data,
  update,
}: {
  data: ManualNode;
  update: (patch: Partial<ManualNode>) => void;
}) {
  const showPassword = TYPES_NEED_PASSWORD.has(data.type);
  const showUuid = TYPES_NEED_UUID.has(data.type);
  const showCipher = data.type === "ss";

  return (
    <div className="grid gap-5">
      <Section title="基础">
        <Field label="name *">
          <Input
            value={data.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder="节点名"
          />
        </Field>
        <Field label="type *">
          <Select value={data.type} onValueChange={(v) => update({ type: v as NodeType })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NODE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="server *">
          <Input
            value={data.server}
            onChange={(e) => update({ server: e.target.value })}
            placeholder="example.com"
          />
        </Field>
        <Field label="port *">
          <Input
            type="number"
            min={1}
            max={65535}
            value={data.port || ""}
            onChange={(e) => update({ port: Number(e.target.value) || 0 })}
          />
        </Field>
      </Section>

      {(showPassword || showUuid || showCipher) && (
        <Section title="凭证">
          {showPassword && (
            <Field label="password" full>
              <Input
                type="password"
                value={data.password ?? ""}
                onChange={(e) => update({ password: e.target.value || undefined })}
              />
            </Field>
          )}
          {showUuid && (
            <Field label="uuid" full>
              <Input
                value={data.uuid ?? ""}
                onChange={(e) => update({ uuid: e.target.value || undefined })}
              />
            </Field>
          )}
          {showCipher && (
            <Field label="cipher" full>
              <Input
                value={data.cipher ?? ""}
                onChange={(e) => update({ cipher: e.target.value || undefined })}
                placeholder="aes-256-gcm / 2022-blake3-aes-256-gcm 等"
              />
            </Field>
          )}
        </Section>
      )}

      <Section title="TLS">
        <Field label="tls" inline>
          <Switch checked={!!data.tls} onCheckedChange={(v) => update({ tls: v || undefined })} />
        </Field>
        <Field label="skip_cert_verify" inline>
          <Switch
            checked={!!data.skip_cert_verify}
            onCheckedChange={(v) => update({ skip_cert_verify: v || undefined })}
          />
        </Field>
        <Field label="sni" full>
          <Input
            value={data.sni ?? ""}
            onChange={(e) => update({ sni: e.target.value || undefined })}
            placeholder="留空则使用 server"
          />
        </Field>
      </Section>

      <Section title="Transport">
        <Field label="network">
          <Select
            value={data.network ?? "tcp"}
            onValueChange={(v) => update({ network: v as NetworkType })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {NETWORK_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {data.network === "ws" && (
          <Field label="ws path" full>
            <Input
              value={data.ws_opts?.path ?? ""}
              onChange={(e) =>
                update({
                  ws_opts: {
                    ...(data.ws_opts ?? {}),
                    path: e.target.value || undefined,
                  },
                })
              }
              placeholder="/"
            />
          </Field>
        )}
      </Section>

      <Section title="开关">
        <Field label="udp-relay" inline>
          <Switch checked={!!data.udp} onCheckedChange={(v) => update({ udp: v || undefined })} />
        </Field>
        <Field label="tfo" inline>
          <Switch checked={!!data.tfo} onCheckedChange={(v) => update({ tfo: v || undefined })} />
        </Field>
      </Section>

      <Section title="标签">
        <Field label="tags (逗号分隔)" full>
          <Input
            value={(data.tags ?? []).join(", ")}
            onChange={(e) => {
              const tags = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
              update({ tags: tags.length > 0 ? tags : undefined });
            }}
            placeholder="如: home, gaming"
          />
        </Field>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{title}</div>
      <div className="grid grid-cols-2 gap-3">{children}</div>
    </div>
  );
}

function Field({
  label,
  children,
  full,
  inline,
}: {
  label: string;
  children: ReactNode;
  full?: boolean;
  inline?: boolean;
}) {
  if (inline) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-muted/20 px-3 h-9">
        <Label className="text-xs">{label}</Label>
        {children}
      </div>
    );
  }
  return (
    <div className={full ? "col-span-2 space-y-1.5" : "space-y-1.5"}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
