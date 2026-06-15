import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useEntityList } from "@/api/entities";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDebouncedWithStaleFlag } from "@/lib/use-debounced";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProxyListEditor, type NodeCandidate } from "./proxy-list-editor";

export interface ProxyGroupData {
  id: string;
  name: string;
  type: "select" | "url-test" | "fallback" | "load-balance" | "smart" | "ssid" | "external";
  proxies: string[];
  /**
   * 嵌套引用的其它策略组(作为单个 proxy 项加入)。存 group **name**,跟后端 yaml 输出
   * 直接对接。客户端会把每个项展示成可点开的子选择器(选 当前组 → Japan → 再选 Japan 的成员)。
   * 跟 selector 是不同维度: selector 是"动态筛选独立节点", nested_groups 是"嵌套引用别的策略组"。
   */
  nested_groups: string[];
  selector?: {
    include_regex?: string;
    exclude_regex?: string;
    /** @deprecated v1 老字段, 后端 schema transform 会自动迁移到顶层 nested_groups, UI 不再写入 */
    include_other_group?: string[];
    from_providers: string[];
    exclude_type: string[];
    include_region: string[];
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
  // @business_rule: 仅 exclude_type chip 使用; undefined = 不显示徽标, 数字(含 0)显示徽标
  count?: number;
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
    region?: string;
  }>;
}

interface Props {
  data: ProxyGroupData;
  update: (patch: Partial<ProxyGroupData>) => void;
}

const NEEDS_TEST = (t: ProxyGroupData["type"]) =>
  t === "url-test" || t === "fallback" || t === "load-balance" || t === "smart";

export function ProxyGroupVisualForm({ data, update }: Props) {
  const providers = useEntityList<NamedItem>("providers");
  const allGroups = useEntityList<NamedItem>("groups");
  const nodePool = useQuery<NodePoolResp>({
    queryKey: ["dashboard", "node-pool"],
    queryFn: () => api.get<NodePoolResp>("/api/dashboard/node-pool"),
    staleTime: 30_000,
  });

  const sel = data.selector ?? {
    from_providers: [],
    exclude_type: [],
    include_region: [],
  };

  const ensureSelector = () => sel;

  // @business_rule: nested_groups (嵌套引用其它策略组) 数据源 — 兜底空数组,
  // 老 yaml 经后端 schema transform 已把 selector.include_other_group 搬过来,
  // 前端这里只读写顶层字段。
  const nestedGroups = data.nested_groups ?? [];

  // @user_flow: include_regex / exclude_regex 输入后 300ms 防抖再生效,期间 isStale = true 用于动画提示。
  // 与后端 backend/src/generators/node-filter.ts 的 applyNodeFilter 保持顺序与语义一致(invalid regex 静默忽略)。
  const { value: debouncedRegex, isStale: isRegexStale } = useDebouncedWithStaleFlag(
    {
      include: sel.include_regex ?? "",
      exclude: sel.exclude_regex ?? "",
    },
    300,
  );

  // @business_rule: from_providers 为空 = 「全部来源(含未来新增机场)」,候选区显示整个节点池,
  // 与后端 clash.ts / surge.ts / chain/apply.ts 的 "from_providers.length === 0 即不过滤" 语义一致。
  // 非空时只保留来源命中的节点。
  // @user_flow: 用户切换 from_providers / include_regex / exclude_regex / exclude_type / include_region
  // 任一筛选条件,候选立即跟随过滤(对齐后端 applyNodeFilter + 各 generator 的 selector pipeline),
  // 无需重新请求后端。pipeline 顺序与后端 clash.ts / surge.ts 保持一致:
  //   from_providers → include_region → exclude_type → include_regex → exclude_regex
  const candidateNodes = useMemo<NodeCandidate[]>(() => {
    const all = nodePool.data?.nodes ?? [];
    let filtered: NodePoolResp["nodes"];
    if (sel.from_providers.length === 0) {
      filtered = all;
    } else {
      const allow = new Set(sel.from_providers);
      filtered = all.filter((n) => n.source_provider_id && allow.has(n.source_provider_id));
    }
    if (sel.include_region.length > 0) {
      const allowRegions = new Set(sel.include_region);
      // 白名单:region 未识别(undefined)的节点也排除,与后端 clash.ts / surge.ts 行为一致。
      filtered = filtered.filter((n) => n.region && allowRegions.has(n.region));
    }
    let list = filtered.map((n) => ({ name: n.name, type: n.type, source_provider_id: n.source_provider_id }));
    if (sel.exclude_type.length > 0) {
      const blocked = new Set(sel.exclude_type);
      list = list.filter((n) => !blocked.has(n.type));
    }
    // 与后端 applyNodeFilter / chain/apply.ts / clash.ts / surge.ts 一致,
    // include/exclude_regex 一律带 "i" flag 大小写不敏感,避免用户在 placeholder 看到 (?i) 字面量后照抄
    // 却踩到 JS RegExp 不支持 PCRE 内联标志的坑(语法上会抛 SyntaxError 被 try/catch 静默吞掉)。
    if (debouncedRegex.include) {
      try {
        const re = new RegExp(debouncedRegex.include, "i");
        list = list.filter((n) => re.test(n.name));
      } catch {
        // invalid regex 静默忽略;UI 上保持上一轮可用结果,避免输入到一半瞬间清空
      }
    }
    if (debouncedRegex.exclude) {
      try {
        const re = new RegExp(debouncedRegex.exclude, "i");
        list = list.filter((n) => !re.test(n.name));
      } catch {
        // 同上
      }
    }
    return list;
  }, [
    nodePool.data?.nodes,
    sel.from_providers,
    sel.exclude_type,
    sel.include_region,
    debouncedRegex.include,
    debouncedRegex.exclude,
  ]);

  const candidateGroups = useMemo(() => {
    return (allGroups.data?.items ?? []).filter((g) => g.id !== data.id);
  }, [allGroups.data?.items, data.id]);

  // @business_rule: 全量节点池 name 集合 —— 给「已锁定」段每行做三态分类:
  // 在 candidateNodes (selector 命中) / 仅在节点池但 selector 不命中 / 完全不存在。
  // 不受 selector / search 影响,跟 candidateNodes 是不同集合(后者会随筛选条件收窄)。
  const allPoolNodeNames = useMemo(() => {
    return new Set((nodePool.data?.nodes ?? []).map((n) => n.name));
  }, [nodePool.data?.nodes]);

  // @business_rule: exclude_type chip 上的数字 = 当前 from_providers 范围内该 type 的节点数。
  // from_providers 为空时按后端语义"空=所有 Provider"统计整个节点池(UI 候选区虽然此时不显示,但
  // 用户依然能感知到节点池里每种类型的总量,便于决定是否切某个 provider)。
  // 仅按 type 聚合, 不叠加 include/exclude_regex —— regex 是按名字筛, 与"类型分布"是不同维度,
  // 叠加上去会让数字随每次输入抖动, 反而干扰判断。
  const typeCounts = useMemo<Record<string, number>>(() => {
    const all = nodePool.data?.nodes ?? [];
    const scope = sel.from_providers.length === 0
      ? all
      : all.filter((n) => n.source_provider_id && sel.from_providers.includes(n.source_provider_id));
    const counts: Record<string, number> = {};
    for (const n of scope) {
      counts[n.type] = (counts[n.type] ?? 0) + 1;
    }
    return counts;
  }, [nodePool.data?.nodes, sel.from_providers]);

  const excludeTypeItems = useMemo<NamedItem[]>(
    () => NODE_TYPES.map((t) => ({ id: t, name: t, count: typeCounts[t] ?? 0 })),
    [typeCounts],
  );

  // @business_rule: include_region chip 上的数字 = 当前 from_providers 范围内该地区的节点数。
  // 与 typeCounts 同理:from_providers 空 = 按整个节点池统计;不叠加 regex / exclude_type
  // (前者每次输入抖动数字, 后者类型和地区是正交两维, 叠加上去用户难以判断该选哪个 region)。
  // 与 exclude_type 不同的是:这里只展示节点池里**确实存在**的地区(count > 0),不像 NODE_TYPES
  // 那样把全表 14 种类型都列出来 —— 地区表有几十个 ISO 码,全列噪音太大;参考节点池页 FacetRow 行为。
  const regionCounts = useMemo<Record<string, number>>(() => {
    const all = nodePool.data?.nodes ?? [];
    const scope = sel.from_providers.length === 0
      ? all
      : all.filter((n) => n.source_provider_id && sel.from_providers.includes(n.source_provider_id));
    const counts: Record<string, number> = {};
    for (const n of scope) {
      if (n.region) counts[n.region] = (counts[n.region] ?? 0) + 1;
    }
    return counts;
  }, [nodePool.data?.nodes, sel.from_providers]);

  // 按节点数降序排序,与节点池页 FacetRow region 的展示一致 —— 让 JP/US/HK 这种大头排最前。
  const includeRegionItems = useMemo<NamedItem[]>(
    () =>
      Object.entries(regionCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([code, count]) => ({ id: code, name: code, count })),
    [regionCounts],
  );

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
            <SelectItem value="smart">smart [Surge] (Clash 等价 url-test)</SelectItem>
            <SelectItem value="ssid">ssid (按 WiFi) [Surge]</SelectItem>
            <SelectItem value="external">external [Surge]</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {NEEDS_TEST(data.type) && (
        <fieldset className="border rounded-md p-3">
          <legend className="text-xs font-medium px-1">
            测速参数
            {data.type === "smart" && (
              <span className="font-normal text-muted-foreground"> · 仅 Clash 需要填(降级为 url-test;Surge smart 用不到)</span>
            )}
          </legend>
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
                placeholder="JP|HK|日本|香港"
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
                placeholder="expire|官网|到期"
              />
            </Field>
          </div>
          <Field label="from_providers (节点来源)">
            <FromProvidersSelect
              items={providers.data?.items ?? []}
              selected={sel.from_providers}
              onChange={(arr) => update({ selector: { ...ensureSelector(), from_providers: arr } })}
            />
          </Field>
          {/* @user_flow: 「嵌套引用其它策略组」不在这里 — 它已挪到下方 ProxyListEditor 的快捷区,
              跟 DIRECT/REJECT 同级。selector 只做"筛选独立节点"维度的事(regex / providers / region / type)。
              老 yaml 的 selector.include_other_group 会被后端 schema transform 自动迁移到顶层 nested_groups。 */}
          <Field label="exclude_type (排除节点类型)">
            <ChipMultiSelect
              items={excludeTypeItems}
              selected={sel.exclude_type}
              onChange={(arr) => update({ selector: { ...ensureSelector(), exclude_type: arr } })}
              empty="不排除"
            />
          </Field>
          <Field label="include_region (只保留地区)">
            <ChipMultiSelect
              items={includeRegionItems}
              selected={sel.include_region}
              onChange={(arr) => update({ selector: { ...ensureSelector(), include_region: arr } })}
              empty="当前范围内无可识别地区的节点"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="border rounded-md p-3">
        <legend className="text-xs font-medium px-1">候选节点与已锁定列表</legend>
        <div
          className="transition-opacity duration-150 ease-out"
          style={{ opacity: isRegexStale ? 0.5 : 1 }}
        >
          <ProxyListEditor
            proxies={data.proxies}
            onChange={(arr) => update({ proxies: arr })}
            nestedGroups={nestedGroups}
            onNestedGroupsChange={(arr) => update({ nested_groups: arr })}
            candidateNodes={candidateNodes}
            candidateGroups={candidateGroups}
            providers={providers.data?.items ?? []}
            onRefreshNodes={() => nodePool.refetch()}
            isLoadingNodes={nodePool.isLoading}
            hasAnyProvider={(providers.data?.items.length ?? 0) > 0}
            totalNodePoolSize={nodePool.data?.nodes.length ?? 0}
            allPoolNodeNames={allPoolNodeNames}
          />
        </div>
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

// @business_rule: from_providers 专用选择器 —— 空数组 = 「全部来源(含未来新增机场)」,
// 与后端 clash.ts / surge.ts / chain/apply.ts 的 "from_providers.length === 0 即不过滤" 语义一致。
// 这样新增机场后无需回到策略组重新勾选,下次拉订阅自动带出。
// @user_flow: 置顶一个「全部来源」chip(激活态 = 当前为空数组),与各 provider chip 互斥:
//   - 点「全部来源」→ 清空(回到全部模式)
//   - 全部模式下点某个 provider → 切到只含该 provider 的显式模式
//   - 显式模式下 toggle provider;移除最后一个 → 自然回到空数组 = 全部模式
function FromProvidersSelect({
  items,
  selected,
  onChange,
}: {
  items: NamedItem[];
  selected: string[];
  onChange: (arr: string[]) => void;
}) {
  if (items.length === 0) {
    return <div className="text-xs text-muted-foreground">暂无节点源 — 请先到「节点源」页面新建</div>;
  }
  const isAll = selected.length === 0;
  const toggleProvider = (id: string) => {
    if (isAll) {
      // 从「全部」切到显式:只选当前点击的这一个
      onChange([id]);
      return;
    }
    if (selected.includes(id)) onChange(selected.filter((s) => s !== id));
    else onChange([...selected, id]);
  };
  return (
    <div className="flex flex-wrap gap-1.5">
      <button
        type="button"
        onClick={() => onChange([])}
        title="选中后,本组使用全部节点源,且自动带出后续新增的机场(无需再回来勾选)"
        className={cn(
          "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border",
          isAll
            ? "bg-primary text-primary-foreground border-primary"
            : "bg-background text-foreground hover:bg-accent border-input",
        )}
      >
        全部来源(含未来新增机场)
      </button>
      {items.map((item) => {
        const active = !isAll && selected.includes(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => toggleProvider(item.id)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground hover:bg-accent border-input",
            )}
          >
            <span>{item.name}</span>
          </button>
        );
      })}
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
        const showCount = item.count !== undefined;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => toggle(item.id)}
            className={cn(
              "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground hover:bg-accent border-input",
            )}
          >
            <span>{item.name}</span>
            {showCount && (
              <span
                className={cn(
                  "inline-flex items-center justify-center rounded-sm px-1 text-[10px] leading-4 tabular-nums",
                  active
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : item.count === 0
                      ? "bg-muted text-muted-foreground/60"
                      : "bg-muted text-muted-foreground",
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
