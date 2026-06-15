import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEntity, useSaveEntity } from "@/api/entities";
import { api } from "@/lib/api";
import { useDebounced, useDebouncedWithStaleFlag } from "@/lib/use-debounced";
import { toast } from "@/components/ui/toast";
import type { Profile, NodePoolPreviewResp, RuleModuleRef, ChainRule } from "./types";

export function useProfileForm(id: string) {
  const queryClient = useQueryClient();
  const profileQuery = useEntity<Profile>("profiles", id);
  const save = useSaveEntity<Profile>("profiles");
  const [draft, setDraft] = useState<Profile | null>(null);
  const [dirty, setDirty] = useState(false);
  const initialRef = useRef<string>("");

  useEffect(() => {
    if (profileQuery.data && initialRef.current !== profileQuery.data.id + ":" + profileQuery.dataUpdatedAt) {
      setDraft(JSON.parse(JSON.stringify(profileQuery.data)));
      initialRef.current = profileQuery.data.id + ":" + profileQuery.dataUpdatedAt;
      setDirty(false);
    }
  }, [profileQuery.data, profileQuery.dataUpdatedAt]);

  const update = (patch: Partial<Profile>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
  };

  const updateNested = <K extends keyof Profile>(key: K, patch: Partial<Profile[K]>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const current = prev[key] as object;
      return { ...prev, [key]: { ...current, ...patch } };
    });
    setDirty(true);
  };

  const replaceDraft = (next: Profile) => {
    setDraft(next);
    setDirty(true);
  };

  const onSave = async (override?: Profile) => {
    const target = override ?? draft;
    if (!target) return;
    try {
      await save.mutateAsync(target);
      toast({ title: "已保存", variant: "success" });
      setDirty(false);
      // preview 现在以 draft 为输入,保存后无需 invalidate(draft 本就在内存中);
      // node-pool-preview 仍依赖磁盘 provider 状态,保留 invalidate
      queryClient.invalidateQueries({ queryKey: ["node-pool-preview", id] });
    } catch (err) {
      toast({ title: "保存失败", description: String(err), variant: "error" });
    }
  };

  const onRegenerateToken = async () => {
    if (!window.confirm("重新生成 token 后,旧的订阅 URL 会失效。继续?")) return;
    try {
      const data = await api.post<{ token: string }>(`/api/profiles/${id}/regenerate-token`);
      toast({ title: "Token 已更新", variant: "success" });
      setDraft((prev) => (prev ? { ...prev, token: data.token } : prev));
      profileQuery.refetch();
    } catch (err) {
      toast({ title: "失败", description: String(err), variant: "error" });
    }
  };

  return {
    profileQuery,
    draft,
    dirty,
    update,
    updateNested,
    replaceDraft,
    onSave,
    onRegenerateToken,
    saving: save.isPending,
  };
}

export function useNodePoolPreview(id: string, draft: Profile | null) {
  // @user_flow: isStaleInput 用于让候选列表在防抖窗口内做渐隐动画提示,不影响 query 本身。
  const { value: debouncedKey, isStale: isStaleInput } = useDebouncedWithStaleFlag(
    {
      providers: draft?.providers ?? [],
      include_regex: draft?.node_filter.include_regex ?? "",
      exclude_regex: draft?.node_filter.exclude_regex ?? "",
      // rename_rules 也参与预览:列表展示的名字与订阅产物一致(重命名 + 重名前缀)
      rename_rules: draft?.node_filter.rename_rules ?? [],
      exclude_types: draft?.node_filter.exclude_types ?? [],
      sort_by_region: draft?.node_filter.sort_by_region ?? false,
    },
    300,
  );
  const query = useQuery<NodePoolPreviewResp>({
    queryKey: ["node-pool-preview", id, debouncedKey],
    queryFn: () =>
      api.post<NodePoolPreviewResp>(`/api/profiles/${id}/node-pool-preview`, {
        providers: debouncedKey.providers,
        node_filter: {
          include_regex: debouncedKey.include_regex || undefined,
          exclude_regex: debouncedKey.exclude_regex || undefined,
          exclude_types: debouncedKey.exclude_types,
          rename_rules: debouncedKey.rename_rules,
          sort_by_region: debouncedKey.sort_by_region,
        },
      }),
    enabled: !!id && !!draft,
    // 关键反闪烁:queryKey 变化时保留上一次的 data,让"先变灰再复原"动画期间下方仍展示旧节点列表,
    // 避免瞬间出现"加载节点池中..."文案;isFetching 仍能驱动 opacity 渐隐。
    placeholderData: keepPreviousData,
    // SWR:某些机场首次无 cache、正在后台拉取时,后端回 revalidating=true,
    // 这里短轮询直到 cache 就绪(返回 false 停止),让冷启动的节点池自动补全。
    refetchInterval: (query) => (query.state.data?.revalidating ? 2000 : false),
  });
  return Object.assign(query, { isStaleInput });
}

export function useGeneratedPreview(
  id: string,
  target: "clash" | "surge",
  draft: Profile | null,
  enabled: boolean,
) {
  const debouncedDraft = useDebounced(draft, 500);
  return useQuery<{ target: string; text: string; warnings: string[]; node_count: number; revalidating?: boolean }>({
    // queryKey 直接用 debouncedDraft 对象,react-query 内部 hashFn 自己做 stable hash,
    // 不必每次 render 都 JSON.stringify 一遍。
    queryKey: ["preview", id, target, debouncedDraft],
    queryFn: ({ signal }) =>
      api.post(
        `/api/profiles/${id}/preview`,
        { profile: debouncedDraft, target },
        // 上一次请求未完成时,react-query 在 key 变化时自动 abort,省一次往返。
        { signal },
      ),
    enabled: enabled && !!debouncedDraft,
    // 关键反闪烁:queryKey 变化时保留上一次的 data,YamlEditor 不会卸载,
    // 头部 RefreshCw 仍会通过 isFetching 提示后台正在刷新。
    placeholderData: keepPreviousData,
    // 同 draft 30 秒内不重发(切 tab 来回、collapse 展开等场景免去冗余请求)。
    staleTime: 30_000,
    // 个人自用,不需要 windowFocus 自动刷新。
    refetchOnWindowFocus: false,
    // SWR:首屏命中"机场首次无 cache"时后端回 revalidating=true,这里短轮询直到 cache 就绪。
    // 注意 staleTime=30s 不会阻塞 refetchInterval(后者独立调度),冷启动几秒内即可自动补全。
    refetchInterval: (query) => (query.state.data?.revalidating ? 2000 : false),
  });
}

export function policyOptionsForGroups(groupNames: string[]): string[] {
  return Array.from(
    new Set([...groupNames, "DIRECT", "REJECT", "REJECT-DROP", "REJECT-NO-DROP", "REJECT-TINYGIF"]),
  );
}

export function makeRuleSetRef(refId: string, policy: string): RuleModuleRef {
  return { ref: refId, policy, enabled: true };
}

export function makeFinal(policy: string): RuleModuleRef {
  return { final: policy };
}

export function makeGeoipCn(policy: string): RuleModuleRef {
  return { geoip_cn: true, policy };
}

export function emptyChainRule(via: string): ChainRule {
  return { selector: {}, via };
}
