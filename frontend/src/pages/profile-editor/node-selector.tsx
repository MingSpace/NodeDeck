import { useMemo, useState } from "react";
import { Network, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useEntityList } from "@/api/entities";
import { useNodePoolPreview } from "./use-profile-form";
import type { Profile } from "./types";

interface ProviderItem {
  id: string;
  name: string;
  enabled: boolean;
}

interface Props {
  profileId: string;
  draft: Profile;
  onChange: (patch: Partial<Profile>) => void;
  onFilterChange: (patch: Partial<Profile["node_filter"]>) => void;
}

export function NodeSelector({ profileId, draft, onChange, onFilterChange }: Props) {
  const providers = useEntityList<ProviderItem>("providers");
  const preview = useNodePoolPreview(profileId, draft);
  const [search, setSearch] = useState("");

  const selectedSet = useMemo(() => new Set(draft.providers), [draft.providers]);

  const toggleProvider = (id: string) => {
    if (selectedSet.has(id)) {
      onChange({ providers: draft.providers.filter((p) => p !== id) });
    } else {
      onChange({ providers: [...draft.providers, id] });
    }
  };

  const filteredNodes = useMemo(() => {
    if (!preview.data) return [];
    if (!search) return preview.data.nodes;
    const f = search.toLowerCase();
    return preview.data.nodes.filter(
      (n) =>
        n.name.toLowerCase().includes(f) ||
        n.server.toLowerCase().includes(f) ||
        (n.region ?? "").toLowerCase().includes(f),
    );
  }, [preview.data, search]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 py-2.5 border-b bg-muted/30 flex items-center gap-2 shrink-0">
        <Network className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground">节点来源</span>
      </div>

      <div className="px-3 py-3 space-y-3 border-b shrink-0">
        <div>
          <div className="text-xs font-medium mb-1.5 flex items-center justify-between">
            <span>启用的节点源</span>
            <span className="text-muted-foreground font-normal">
              {draft.providers.length} / {providers.data?.items.length ?? 0}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {providers.data?.items.map((p) => {
              const active = selectedSet.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => toggleProvider(p.id)}
                  className={
                    "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors disabled:opacity-50 disabled:cursor-not-allowed " +
                    (active
                      ? "bg-primary text-primary-foreground border-primary shadow-sm hover:bg-primary/90"
                      : "bg-background text-foreground border-input hover:bg-accent hover:border-accent-foreground/20")
                  }
                  disabled={!p.enabled}
                  title={p.enabled ? p.id : `${p.id} (已禁用)`}
                >
                  {p.name}
                </button>
              );
            })}
            {providers.data?.items.length === 0 && (
              <span className="text-xs text-muted-foreground">暂无节点源,请先到「节点源」添加</span>
            )}
          </div>
          <label className="flex items-center gap-2 mt-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={draft.include_manual_nodes}
              onChange={(e) => onChange({ include_manual_nodes: e.target.checked })}
              className="h-3.5 w-3.5"
            />
            包含手动节点
          </label>
        </div>

        <div className="space-y-2">
          <div>
            <label className="text-xs font-medium block mb-1">包含正则 (include_regex)</label>
            <Input
              value={draft.node_filter.include_regex ?? ""}
              onChange={(e) => onFilterChange({ include_regex: e.target.value || undefined })}
              placeholder="留空 = 全部"
              className="h-8 text-xs"
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">排除正则 (exclude_regex)</label>
            <Input
              value={draft.node_filter.exclude_regex ?? ""}
              onChange={(e) => onFilterChange({ exclude_regex: e.target.value || undefined })}
              placeholder="(?i)(过期|expired|官网|流量|剩余)"
              className="h-8 text-xs"
            />
          </div>
        </div>
      </div>

      <div className="px-3 py-2 border-b flex items-center gap-2 shrink-0">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={`搜索 ${preview.data?.count ?? 0} 个匹配节点`}
          className="h-7 text-xs border-0 shadow-none focus-visible:ring-0 px-0"
        />
        {preview.data && (
          <Badge variant="secondary" className="text-xs">
            {preview.data.count}/{preview.data.raw_count}
          </Badge>
        )}
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {preview.isLoading && (
          <div className="p-4 text-xs text-muted-foreground">加载节点池中...</div>
        )}
        {preview.error && (
          <div className="p-4 text-xs text-destructive">加载失败: {String(preview.error)}</div>
        )}
        {preview.data && filteredNodes.length === 0 && (
          <div className="p-4 text-xs text-muted-foreground text-center">无匹配节点</div>
        )}
        <div className="divide-y">
          {filteredNodes.map((n, i) => (
            <div
              key={`${n.name}-${i}`}
              className="px-3 py-1.5 flex items-center gap-2 hover:bg-muted/30 text-xs"
              title={`${n.name}\n${n.server}:${n.port}${n.region ? ` · ${n.region}` : ""}${n.line ? ` · ${n.line}` : ""}`}
            >
              <Badge variant="outline" className="font-mono text-[10px] px-1.5 py-0 shrink-0">
                {n.type}
              </Badge>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{n.name}</div>
                <div className="text-muted-foreground text-[11px] truncate">
                  {n.server}:{n.port}
                  {n.region && ` · ${n.region}`}
                  {n.line && ` · ${n.line}`}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
