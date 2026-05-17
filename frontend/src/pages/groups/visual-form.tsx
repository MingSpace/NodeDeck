import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEntityList } from "@/api/entities";
import { api } from "@/lib/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProxyListEditor, type NodeCandidate } from "./proxy-list-editor";

export interface ProxyGroupData {
  id: string;
  name: string;
  type: "select" | "url-test" | "fallback" | "load-balance" | "smart" | "ssid" | "external";
  proxies: string[];
  selector?: {
    include_regex?: string;
    exclude_regex?: string;
    include_other_group: string[];
    from_providers: string[];
    exclude_type: string[];
  };
  url?: string;
  interval?: number;
  tolerance?: number;
  timeout?: number;
  evaluate_before_use?: boolean;
  hidden?: boolean;
  persistent?: boolean;
  policy_path?: string;
  hybrid?: boolean;
  policy_regex_filter?: string;
  no_alert?: boolean;
  include_all_proxies?: boolean;
  lazy?: boolean;
  disable_udp?: boolean;
  ssid_params?: {
    default?: string;
    cellular?: string;
    wifi?: Record<string, string>;
  };
}

interface NamedItem {
  id: string;
  name: string;
}

// @business_rule: 候选节点池来自 GET /api/dashboard/node-pool,该 API 已合并 enabled provider + manual 节点
// 并做了去重(keep-first)。这里只取展示用到的几个字段。
interface NodePoolResp {
  nodes: Array<{
    name: string;
    type: string;
    server: string;
    port: number;
    source_provider_id?: string;
  }>;
}

interface Props {
  data: ProxyGroupData;
  update: (patch: Partial<ProxyGroupData>) => void;
}

const NEEDS_TEST = (t: ProxyGroupData["type"]) => t === "url-test" || t === "fallback" || t === "load-balance";

export function ProxyGroupVisualForm({ data, update }: Props) {
  const providers = useEntityList<NamedItem>("providers");
  const allGroups = useEntityList<NamedItem>("groups");
  const nodePool = useQuery<NodePoolResp>({
    queryKey: ["dashboard", "node-pool"],
    queryFn: () => api.get<NodePoolResp>("/api/dashboard/node-pool"),
    staleTime: 30_000,
  });

  const sel = data.selector ?? {
    include_other_group: [],
    from_providers: [],
    exclude_type: [],
  };

  const ensureSelector = () => sel;

  // @business_rule: from_providers 非空 → 只显示这些 provider 的节点;
  // 为空 → 视为"所有 Provider"(对齐 selector 语义),包含 manual 节点。
  // @user_flow: 用户切换 from_providers chip 时,候选立即跟随过滤,无需重新请求后端。
  const candidateNodes = useMemo<NodeCandidate[]>(() => {
    const all = nodePool.data?.nodes ?? [];
    if (sel.from_providers.length === 0) {
      return all.map((n) => ({ name: n.name, type: n.type, source_provider_id: n.source_provider_id }));
    }
    const allow = new Set(sel.from_providers);
    return all
      .filter((n) => n.source_provider_id && allow.has(n.source_provider_id))
      .map((n) => ({ name: n.name, type: n.type, source_provider_id: n.source_provider_id }));
  }, [nodePool.data?.nodes, sel.from_providers]);

  const candidateGroups = useMemo(() => {
    return (allGroups.data?.items ?? []).filter((g) => g.id !== data.id);
  }, [allGroups.data?.items, data.id]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="ID (文件名)">
          <Input value={data.id} onChange={(e) => update({ id: e.target.value })} />
        </Field>
        <Field label="组名 (会出现在 client 中)">
          <Input value={data.name} onChange={(e) => update({ name: e.target.value })} />
        </Field>
      </div>

      <Field label="类型">
        <Select value={data.type} onValueChange={(v) => update({ type: v as ProxyGroupData["type"] })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="select">select (手动)</SelectItem>
            <SelectItem value="url-test">url-test (自动选择最快)</SelectItem>
            <SelectItem value="fallback">fallback (按顺序故障转移)</SelectItem>
            <SelectItem value="load-balance">load-balance (负载均衡)</SelectItem>
            <SelectItem value="smart">smart [Surge]</SelectItem>
            <SelectItem value="ssid">ssid (按 WiFi) [Surge]</SelectItem>
            <SelectItem value="external">external [Surge]</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {NEEDS_TEST(data.type) && (
        <fieldset className="border rounded-md p-3">
          <legend className="text-xs font-medium px-1">测速参数</legend>
          <div className="grid grid-cols-2 gap-3">
            <Field label="测试 URL">
              <Input
                value={data.url ?? ""}
                onChange={(e) => update({ url: e.target.value })}
                placeholder="http://cp.cloudflare.com/generate_204"
              />
            </Field>
            <Field label="测试间隔 (秒)">
              <Input
                type="number"
                value={data.interval ?? ""}
                onChange={(e) => update({ interval: e.target.value ? parseInt(e.target.value, 10) : undefined })}
              />
            </Field>
            {data.type === "url-test" && (
              <Field label="容差 (ms)">
                <Input
                  type="number"
                  value={data.tolerance ?? ""}
                  onChange={(e) => update({ tolerance: e.target.value ? parseInt(e.target.value, 10) : undefined })}
                />
              </Field>
            )}
            <Field label="超时 (秒)">
              <Input
                type="number"
                value={data.timeout ?? ""}
                onChange={(e) => update({ timeout: e.target.value ? parseInt(e.target.value, 10) : undefined })}
              />
            </Field>
          </div>
        </fieldset>
      )}

      <fieldset className="border rounded-md p-3">
        <legend className="text-xs font-medium px-1">动态选择器 (selector,可选)</legend>
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <Field label="include_regex">
              <Input
                value={sel.include_regex ?? ""}
                onChange={(e) =>
                  update({
                    selector: {
                      ...ensureSelector(),
                      include_regex: e.target.value || undefined,
                    },
                  })
                }
                placeholder="(?i)JP|HK"
              />
            </Field>
            <Field label="exclude_regex">
              <Input
                value={sel.exclude_regex ?? ""}
                onChange={(e) =>
                  update({
                    selector: { ...ensureSelector(), exclude_regex: e.target.value || undefined },
                  })
                }
                placeholder="(?i)expire|官网"
              />
            </Field>
          </div>
          <Field label="from_providers (从哪些机场拉)">
            <ChipMultiSelect
              items={providers.data?.items ?? []}
              selected={sel.from_providers}
              onChange={(arr) => update({ selector: { ...ensureSelector(), from_providers: arr } })}
              empty="未筛选 = 所有 Provider"
            />
          </Field>
          <Field label="include_other_group (合并其它策略组的成员)">
            <ChipMultiSelect
              items={(allGroups.data?.items ?? []).filter((g) => g.id !== data.id)}
              selected={sel.include_other_group}
              onChange={(arr) => update({ selector: { ...ensureSelector(), include_other_group: arr } })}
              empty="不合并"
            />
          </Field>
          <Field label="exclude_type (排除节点类型)">
            <ChipMultiSelect
              items={NODE_TYPES.map((t) => ({ id: t, name: t }))}
              selected={sel.exclude_type}
              onChange={(arr) => update({ selector: { ...ensureSelector(), exclude_type: arr } })}
              empty="不排除"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border rounded-md p-3">
        <legend className="text-xs font-medium px-1">显式 proxies 列表 (顺序敏感,可拖拽)</legend>
        <ProxyListEditor
          proxies={data.proxies}
          onChange={(arr) => update({ proxies: arr })}
          candidateNodes={candidateNodes}
          candidateGroups={candidateGroups}
          onRefreshNodes={() => nodePool.refetch()}
          isLoadingNodes={nodePool.isLoading}
          hasAnyProvider={(providers.data?.items.length ?? 0) > 0}
        />
      </fieldset>
    </div>
  );
}

const NODE_TYPES = [
  "ss", "ssr", "vmess", "vless", "trojan", "hysteria2", "tuic",
  "wireguard", "snell", "anytls", "socks5", "http", "https", "direct",
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function ChipMultiSelect({
  items,
  selected,
  onChange,
  empty,
}: {
  items: NamedItem[];
  selected: string[];
  onChange: (arr: string[]) => void;
  empty: string;
}) {
  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };
  if (items.length === 0) return <div className="text-xs text-muted-foreground">{empty}</div>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const active = selected.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => toggle(item.id)}
            className={
              active
                ? "px-2 py-1 rounded-md text-xs font-medium border bg-primary text-primary-foreground border-primary"
                : "px-2 py-1 rounded-md text-xs font-medium border bg-background text-foreground hover:bg-accent border-input"
            }
          >
            {item.name}
          </button>
        );
      })}
    </div>
  );
}
