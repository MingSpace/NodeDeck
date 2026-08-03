import { useCallback, useMemo, useState } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  Route,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useEntityList } from "@/api/entities";
import { useChainPreview } from "./use-profile-form";
import { ChainRuleCard } from "./chain-rule-card";
import { HiddenNodesCard, isHiddenSelectorEmpty } from "./hidden-nodes-card";
import type { PickerOption } from "./chain-pickers";
import type { ChainRule, ChainTerminal, HiddenNodeSelector, Profile } from "./types";

interface NamedItem {
  id: string;
  name: string;
}

interface Props {
  profileId: string;
  draft: Profile;
  onChange: (rules: ChainRule[]) => void;
  onHiddenNodesChange: (selector: HiddenNodeSelector | undefined) => void;
}

// 协议全表(与 backend/src/schemas/node.ts nodeTypeSchema 同步)。
// 地区不写死:ISO 码有几十个,只列节点池里确实存在的,与「策略组」页的 selector 编辑一致。
const NODE_TYPES = [
  "ss", "ssr", "vmess", "vless", "trojan", "hysteria2", "tuic",
  "wireguard", "snell", "anytls", "socks5", "http", "https", "direct",
];

const CHAIN_BUILTIN_VIA = ["DIRECT"];

const TERMINAL_LABEL: Record<ChainTerminal, string> = {
  node: "落到节点",
  group: "落到策略组",
  builtin: "内置策略",
  missing: "出口不存在",
  cycle: "成环",
};

export function ChainPanel({ profileId, draft, onChange, onHiddenNodesChange }: Props) {
  const groups = useEntityList<NamedItem>("groups");
  const providers = useEntityList<NamedItem>("providers");
  const preview = useChainPreview(profileId, draft, true);
  // 新加的规则默认展开(用户马上要填),既有规则默认折叠(避免一屏塞不下)。
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [pathsOpen, setPathsOpen] = useState(false);
  // 已经配过就默认展开:用户回到这页多半是来调它的
  const [hiddenOpen, setHiddenOpen] = useState(!isHiddenSelectorEmpty(draft.hidden_nodes));

  const rules = draft.chain_rules;
  const data = preview.data;

  // 只把当前 Profile 引入的策略组列为候选:没引入的组名在生成时会被判为悬空并降级。
  const selectedGroupNames = useMemo(() => {
    const selected = new Set(draft.proxy_groups);
    return (groups.data?.items ?? []).filter((g) => selected.has(g.id)).map((g) => g.name);
  }, [groups.data, draft.proxy_groups]);

  const groupOptions = useMemo<PickerOption[]>(() => {
    const counts = new Map((data?.groups ?? []).map((g) => [g.name, g.member_count]));
    return selectedGroupNames.map((name) => ({ value: name, count: counts.get(name) }));
  }, [selectedGroupNames, data?.groups]);

  const nodeOptions = useMemo<PickerOption[]>(
    () => (data?.nodes ?? []).map((n) => ({ value: n.name, hint: n.region ?? n.type })),
    [data?.nodes],
  );

  const providerOptions = useMemo<PickerOption[]>(
    () => (providers.data?.items ?? []).map((p) => ({ value: p.id, hint: p.name })),
    [providers.data],
  );

  const regionOptions = useMemo<PickerOption[]>(() => {
    const counts = new Map<string, number>();
    for (const n of data?.nodes ?? []) {
      if (n.region) counts.set(n.region, (counts.get(n.region) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([region, count]) => ({ value: region, count }));
  }, [data?.nodes]);

  const typeOptions = useMemo<PickerOption[]>(() => {
    const counts = new Map<string, number>();
    for (const n of data?.nodes ?? []) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    // 节点池里有的排前面并带数量,其余保留在后面便于提前配置
    return [...NODE_TYPES]
      .sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
      .map((t) => ({ value: t, count: counts.get(t) ?? 0 }));
  }, [data?.nodes]);

  // 出口候选:策略组(可当"动态落地池")、节点、DIRECT。
  // REJECT 不列 —— 把它当前置等于把节点打死,没有实际用途。
  const viaOptions = useMemo<PickerOption[]>(
    () => [
      ...groupOptions.map((o) => ({ ...o, group: "策略组" })),
      ...nodeOptions.map((o) => ({ ...o, group: "节点" })),
      ...CHAIN_BUILTIN_VIA.map((v) => ({ value: v, group: "内置策略" })),
    ],
    [groupOptions, nodeOptions],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = useMemo(() => rules.map((rule, idx) => ({ id: `chain-${idx}`, idx, rule })), [rules]);

  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((i) => i.id === active.id);
    const to = items.findIndex((i) => i.id === over.id);
    if (from === -1 || to === -1) return;
    onChange(arrayMove(rules, from, to));
    // 下标即身份,重排后展开态会错位,直接清掉最省心。
    setExpanded(new Set());
  };

  const toggleExpanded = useCallback((idx: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const addRule = () => {
    onChange([...rules, { enabled: true, selector: {}, via: "", mode: "override" }]);
    setExpanded((prev) => new Set(prev).add(rules.length));
  };

  const updateRule = (idx: number, patch: Partial<ChainRule>) => {
    onChange(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRule = (idx: number) => {
    onChange(rules.filter((_, i) => i !== idx));
    setExpanded(new Set());
  };

  const duplicateRule = (idx: number) => {
    const next = rules.slice();
    next.splice(idx + 1, 0, structuredClone(rules[idx]));
    onChange(next);
    setExpanded(new Set([idx + 1]));
  };

  // 已挂链数用解析后的链路条数,而不是 node_count - unmatched_count:
  // 后者会把"没被规则命中但机场原文自带 dialer-proxy"的节点错算成直连。
  const chainedCount = data?.chains.length ?? null;
  const brokenPaths = (data?.chains ?? []).filter(
    (c) => c.terminal === "missing" || c.terminal === "cycle",
  );
  const incompleteCount = rules.filter((r) => r.via.trim().length === 0).length;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b bg-muted/30 px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <LinkIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-medium text-muted-foreground">链式代理</span>
          <span className="text-[11px] text-muted-foreground/70">
            从上到下顺序匹配,每个节点由第一条命中的规则决定前置出口
          </span>
          <div className="flex-1" />
          {preview.isFetching && <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />}
          <Button size="sm" variant="outline" onClick={addRule}>
            <Plus className="h-3.5 w-3.5" />
            添加规则
          </Button>
        </div>
        {data && (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <span>
              节点池 <span className="font-medium tabular-nums text-foreground">{data.node_count}</span>
            </span>
            <span>
              已挂链 <span className="font-medium tabular-nums text-foreground">{chainedCount}</span>
            </span>
            <span>
              直连出站 <span className="tabular-nums">{data.node_count - (chainedCount ?? 0)}</span>
            </span>
            {incompleteCount > 0 && (
              <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3 w-3" />
                {incompleteCount} 条规则还没选出口,保存会被拒绝
              </span>
            )}
            {data.conflict_count > 0 && (
              <span
                className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
                title="这些节点同时命中多条规则,实际只有最靠前的那条生效;拖动排序可以调整优先级"
              >
                <AlertTriangle className="h-3 w-3" />
                {data.conflict_count} 个节点命中多条规则
              </span>
            )}
            {brokenPaths.length > 0 && (
              <span className="inline-flex items-center gap-1 text-destructive">
                <AlertTriangle className="h-3 w-3" />
                {brokenPaths.length} 条链路出口无效,生成时会降级为直连
              </span>
            )}
            {data.revalidating && <span>机场首次拉取中,数字稍后自动补全…</span>}
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="mb-2">
          <HiddenNodesCard
            value={draft.hidden_nodes}
            onChange={onHiddenNodesChange}
            open={hiddenOpen}
            onToggleOpen={() => setHiddenOpen((v) => !v)}
            hiddenCount={data?.hidden_count}
            hiddenSample={data?.hidden_sample}
            nodeOptions={nodeOptions}
            providerOptions={providerOptions}
            regionOptions={regionOptions}
            typeOptions={typeOptions}
          />
        </div>

        {rules.length === 0 ? (
          <EmptyState onAdd={addRule} />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {items.map(({ id, idx, rule }) => (
                  <ChainRuleCard
                    key={id}
                    sortableId={id}
                    index={idx}
                    rule={rule}
                    stat={data?.rules.find((s) => s.index === idx)}
                    expanded={expanded.has(idx)}
                    onToggleExpanded={() => toggleExpanded(idx)}
                    onUpdate={(patch) => updateRule(idx, patch)}
                    onRemove={() => removeRule(idx)}
                    onDuplicate={() => duplicateRule(idx)}
                    viaOptions={viaOptions}
                    groupOptions={groupOptions}
                    nodeOptions={nodeOptions}
                    providerOptions={providerOptions}
                    regionOptions={regionOptions}
                    typeOptions={typeOptions}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        {data && data.chains.length > 0 && (
          <div className="mt-3 rounded-lg border bg-card">
            <button
              type="button"
              onClick={() => setPathsOpen((v) => !v)}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40"
            >
              {pathsOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              <Route className="h-3.5 w-3.5" />
              解析后的链路
              <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] tabular-nums">
                {data.chains.length}
              </span>
              <span className="font-normal text-muted-foreground/70">
                多跳来自「前置本身也挂了链」,不是单条规则能写出来的
              </span>
            </button>
            {pathsOpen && (
              <div className="max-h-72 overflow-auto border-t px-3 py-2">
                <div className="space-y-1">
                  {data.chains.map((c) => (
                    <div key={c.node} className="flex flex-wrap items-center gap-1 text-[11px]">
                      {c.path.map((hop, i) => (
                        <span key={`${hop}-${i}`} className="flex items-center gap-1">
                          {i > 0 && <span className="text-muted-foreground/50">→</span>}
                          <span
                            className={cn(
                              "max-w-[220px] truncate rounded px-1.5 py-0.5 font-mono",
                              i === 0 ? "bg-muted" : "bg-primary/10",
                            )}
                            title={hop}
                          >
                            {hop}
                          </span>
                        </span>
                      ))}
                      <span
                        className={cn(
                          "ml-1 text-[10px]",
                          c.terminal === "missing" || c.terminal === "cycle"
                            ? "text-destructive"
                            : "text-muted-foreground/70",
                        )}
                      >
                        {TERMINAL_LABEL[c.terminal]}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {preview.error && !data && (
          <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            命中预览加载失败:{String(preview.error)}
          </div>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="rounded-lg border border-dashed px-6 py-10 text-center">
      <LinkIcon className="mx-auto h-6 w-6 text-muted-foreground/50" />
      <div className="mt-2 text-sm font-medium">还没有链式规则</div>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
        链式代理让节点先连一个前置出口再落地(Clash <code>dialer-proxy</code> / Surge{" "}
        <code>underlying-proxy</code>)。常见用法:某个策略组的节点统一走 WARP 落地、
        指定几个节点经国内跳板中转。
      </p>
      <Button size="sm" variant="outline" className="mt-3" onClick={onAdd}>
        <Plus className="h-3.5 w-3.5" />
        添加第一条规则
      </Button>
    </div>
  );
}
