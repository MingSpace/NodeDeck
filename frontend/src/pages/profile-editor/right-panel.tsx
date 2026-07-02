import { useMemo, useState } from "react";
import { Layers, Puzzle, Settings as SettingsIcon, Link as LinkIcon, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useEntityList } from "@/api/entities";
import { useNodePoolPreview } from "./use-profile-form";
import type { Profile, ChainRule } from "./types";

interface NamedItem {
  id: string;
  name: string;
}

interface Props {
  profileId: string;
  draft: Profile;
  onChange: (patch: Partial<Profile>) => void;
}

// 策略组选择:Tab「规则 & 策略组」顶部横条,与下方规则流水线的 policy 下拉强关联。
export function ProxyGroupsPicker({
  draft,
  onChange,
}: {
  draft: Profile;
  onChange: (patch: Partial<Profile>) => void;
}) {
  const groups = useEntityList<NamedItem>("groups");
  return (
    <div className="px-4 py-2.5 flex items-start gap-3 flex-wrap">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground shrink-0 h-7">
        <Layers className="h-3.5 w-3.5" />
        <span>策略组</span>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
          {draft.proxy_groups.length}/{groups.data?.items.length ?? 0}
        </Badge>
      </div>
      <div className="flex-1 min-w-0">
        <ChipPicker
          items={groups.data?.items ?? []}
          selected={draft.proxy_groups}
          onToggle={(id) =>
            onChange({
              proxy_groups: draft.proxy_groups.includes(id)
                ? draft.proxy_groups.filter((g) => g !== id)
                : [...draft.proxy_groups, id],
            })
          }
          empty="暂无策略组,前往「策略组」添加"
        />
      </div>
    </div>
  );
}

// 高级 / 输出:Tab「高级」内容,卡片式 2 列平铺(原右栏纵向堆叠太挤)。
export function AdvancedPanel({ profileId, draft, onChange }: Props) {
  const modules = useEntityList<NamedItem>("modules");
  const generals = useEntityList<NamedItem>("generals");
  const providers = useEntityList<NamedItem>("providers");
  const groups = useEntityList<NamedItem>("groups");
  const nodePool = useNodePoolPreview(profileId, draft);

  const selectedGroupNames = useMemo(() => {
    const selected = new Set(draft.proxy_groups);
    return (groups.data?.items ?? [])
      .filter((g) => selected.has(g.id))
      .map((g) => g.name);
  }, [groups.data, draft.proxy_groups]);

  const nodeNames = useMemo(
    () => Array.from(new Set((nodePool.data?.nodes ?? []).map((n) => n.name))),
    [nodePool.data],
  );

  return (
    <div className="h-full min-h-0 overflow-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
        <Section icon={<Puzzle className="h-3.5 w-3.5" />} title="Surge 模块" count={`${draft.surge_modules.length}/${modules.data?.items.length ?? 0}`}>
          <ChipPicker
            items={modules.data?.items ?? []}
            selected={draft.surge_modules}
            onToggle={(id) =>
              onChange({
                surge_modules: draft.surge_modules.includes(id)
                  ? draft.surge_modules.filter((m) => m !== id)
                  : [...draft.surge_modules, id],
              })
            }
            empty="暂无模块"
          />
        </Section>

        <Section icon={<SettingsIcon className="h-3.5 w-3.5" />} title="General 预设">
          <Select
            value={draft.general_preset ?? "__none__"}
            onValueChange={(v) => onChange({ general_preset: v === "__none__" ? undefined : v })}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="选择 General" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__" className="text-xs italic text-muted-foreground">
                不引用
              </SelectItem>
              {generals.data?.items.map((g) => (
                <SelectItem key={g.id} value={g.id} className="text-xs">
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Section>

        <Section
          className="lg:col-span-2"
          icon={<LinkIcon className="h-3.5 w-3.5" />}
          title="链式代理 (chain_rules)"
          count={String(draft.chain_rules.length)}
        >
          <ChainRulesEditor
            rules={draft.chain_rules}
            providers={providers.data?.items ?? []}
            groupNames={selectedGroupNames}
            nodeNames={nodeNames}
            onChange={(rules) => onChange({ chain_rules: rules })}
          />
        </Section>

        <Section
          icon={<SettingsIcon className="h-3.5 w-3.5" />}
          title="流量信息 (Subscription-UserInfo)"
          trailing={
            <Switch
              checked={draft.userinfo.enabled}
              onCheckedChange={(v) =>
                onChange({ userinfo: { ...draft.userinfo, enabled: v } })
              }
              aria-label="启用 Subscription-UserInfo"
            />
          }
          collapsed={!draft.userinfo.enabled}
          collapsedHint="未启用 — 不会输出 Subscription-UserInfo / X-NodeDeck-Userinfo-* 响应头"
        >
          <div className="space-y-2">
            <Select
              value={draft.userinfo.mode}
              onValueChange={(v) =>
                onChange({ userinfo: { ...draft.userinfo, mode: v as "primary" | "sum" } })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sum" className="text-xs">sum (各机场求和)</SelectItem>
                <SelectItem value="primary" className="text-xs">primary (单机场)</SelectItem>
              </SelectContent>
            </Select>
            {draft.userinfo.mode === "primary" && (
              <Select
                value={draft.userinfo.primary_provider ?? ""}
                onValueChange={(v) =>
                  onChange({ userinfo: { ...draft.userinfo, primary_provider: v || undefined } })
                }
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="选择主机场" />
                </SelectTrigger>
                <SelectContent>
                  {providers.data?.items.map((p) => (
                    <SelectItem key={p.id} value={p.id} className="text-xs">
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={draft.userinfo.expose_per_provider_headers}
                onChange={(e) =>
                  onChange({ userinfo: { ...draft.userinfo, expose_per_provider_headers: e.target.checked } })
                }
                className="h-3.5 w-3.5"
              />
              暴露每机场 X-NodeDeck-Userinfo-* 响应头
            </label>
          </div>
        </Section>

        <Section icon={<SettingsIcon className="h-3.5 w-3.5" />} title="Clash 输出选项">
          <div className="space-y-2">
            <div>
              <label className="text-xs block mb-1">flag (客户端方言)</label>
              <Select
                value={draft.clash_options.flag}
                onValueChange={(v) =>
                  onChange({ clash_options: { ...draft.clash_options, flag: v as "mihomo" | "stash" } })
                }
              >
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mihomo" className="text-xs">mihomo (Clash Meta)</SelectItem>
                  <SelectItem value="stash" className="text-xs">stash</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={draft.clash_options.use_proxy_providers}
                onChange={(e) =>
                  onChange({
                    clash_options: { ...draft.clash_options, use_proxy_providers: e.target.checked },
                  })
                }
                className="h-3.5 w-3.5"
              />
              使用 proxy-providers (远程拉取)
            </label>
          </div>
        </Section>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  trailing,
  collapsed,
  collapsedHint,
  className,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count?: string;
  trailing?: React.ReactNode;
  collapsed?: boolean;
  collapsedHint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border bg-card overflow-hidden self-start", className)}>
      <div className="px-4 py-2.5 bg-muted/30 border-b flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {icon}
        <span className="flex-1">{title}</span>
        {count && <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{count}</Badge>}
        {trailing}
      </div>
      {collapsed ? (
        collapsedHint ? (
          <div className="px-4 py-3 text-[11px] text-muted-foreground italic">{collapsedHint}</div>
        ) : null
      ) : (
        <div className="px-4 py-3">{children}</div>
      )}
    </div>
  );
}

function ChipPicker({
  items,
  selected,
  onToggle,
  empty,
}: {
  items: NamedItem[];
  selected: string[];
  onToggle: (id: string) => void;
  empty: string;
}) {
  if (items.length === 0) {
    return <div className="text-xs text-muted-foreground">{empty}</div>;
  }
  const selSet = new Set(selected);
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const active = selSet.has(item.id);
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onToggle(item.id)}
            className={
              active
                ? "px-2 py-1 rounded-md text-xs font-medium border bg-primary text-primary-foreground border-primary"
                : "px-2 py-1 rounded-md text-xs font-medium border bg-background text-foreground hover:bg-accent border-input"
            }
            title={item.id}
          >
            {item.name}
          </button>
        );
      })}
    </div>
  );
}

function ChainRulesEditor({
  rules,
  providers,
  groupNames,
  nodeNames,
  onChange,
}: {
  rules: ChainRule[];
  providers: NamedItem[];
  groupNames: string[];
  nodeNames: string[];
  onChange: (rules: ChainRule[]) => void;
}) {
  const [draft, setDraft] = useState<ChainRule>({ selector: {}, via: "" });

  const add = () => {
    if (!draft.via.trim()) return;
    onChange([...rules, draft]);
    setDraft({ selector: {}, via: "" });
  };

  const providerNames = useMemo(() => providers.map((p) => p.id), [providers]);

  return (
    <div className="space-y-2">
      {rules.length === 0 && (
        <div className="text-xs text-muted-foreground">暂无链式规则</div>
      )}
      {rules.map((r, i) => (
        <div key={i} className="border rounded-md p-2 space-y-1.5 bg-muted/20">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px]">via</Badge>
            <span className="text-xs font-mono flex-1 truncate">{r.via}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => onChange(rules.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
          <div className="text-[11px] text-muted-foreground space-y-0.5">
            {r.selector.include_regex && <div>include: <code>{r.selector.include_regex}</code></div>}
            {r.selector.exclude_regex && <div>exclude: <code>{r.selector.exclude_regex}</code></div>}
            {(r.selector.from_providers?.length ?? 0) > 0 && (
              <div>from: {r.selector.from_providers!.join(", ")}</div>
            )}
            {(r.selector.exclude_type?.length ?? 0) > 0 && (
              <div>exclude type: {r.selector.exclude_type!.join(", ")}</div>
            )}
          </div>
        </div>
      ))}

      <details className="border rounded-md">
        <summary className="px-2 py-1.5 cursor-pointer text-xs font-medium hover:bg-muted/40">
          <Plus className="h-3 w-3 inline mr-1" />
          添加链式规则
        </summary>
        <div className="p-2 grid grid-cols-1 sm:grid-cols-3 gap-2 border-t">
          <div>
            <label className="text-[11px] block mb-1">via (出口节点/组名)</label>
            <input
              list="chain-via-suggestions"
              value={draft.via}
              onChange={(e) => setDraft({ ...draft, via: e.target.value })}
              placeholder="例如: 🇯🇵 JP-DIP"
              className="flex h-7 w-full rounded-md border border-input bg-background px-3 py-1 text-xs shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
            <datalist id="chain-via-suggestions">
              {groupNames.map((name) => (
                <option key={`group-${name}`} value={name} label="策略组" />
              ))}
              {nodeNames.map((name) => (
                <option key={`node-${name}`} value={name} label="节点" />
              ))}
            </datalist>
          </div>
          <div>
            <label className="text-[11px] block mb-1">include_regex</label>
            <Input
              value={draft.selector.include_regex ?? ""}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  selector: { ...draft.selector, include_regex: e.target.value || undefined },
                })
              }
              placeholder="stream|netflix|disney"
              className="h-7 text-xs"
            />
          </div>
          <div>
            <label className="text-[11px] block mb-1">from_providers (逗号分隔)</label>
            <Input
              value={(draft.selector.from_providers ?? []).join(", ")}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  selector: {
                    ...draft.selector,
                    from_providers: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  },
                })
              }
              placeholder={providerNames.slice(0, 2).join(", ")}
              className="h-7 text-xs"
            />
          </div>
          <Button size="sm" onClick={add} disabled={!draft.via.trim()} className="w-full h-7 text-xs sm:col-span-3">
            <Plus className="h-3 w-3" />
            添加
          </Button>
        </div>
      </details>
    </div>
  );
}
