import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEntity, useSaveEntity } from "@/api/entities";
import { api } from "@/lib/api";
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
      queryClient.invalidateQueries({ queryKey: ["preview", id] });
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
  const debouncedKey = useDebounced(
    {
      providers: draft?.providers ?? [],
      include_manual_nodes: draft?.include_manual_nodes ?? true,
      include_regex: draft?.node_filter.include_regex ?? "",
      exclude_regex: draft?.node_filter.exclude_regex ?? "",
      exclude_types: draft?.node_filter.exclude_types ?? [],
    },
    300,
  );
  return useQuery<NodePoolPreviewResp>({
    queryKey: ["node-pool-preview", id, debouncedKey],
    queryFn: () =>
      api.post<NodePoolPreviewResp>(`/api/profiles/${id}/node-pool-preview`, {
        providers: debouncedKey.providers,
        include_manual_nodes: debouncedKey.include_manual_nodes,
        node_filter: {
          include_regex: debouncedKey.include_regex || undefined,
          exclude_regex: debouncedKey.exclude_regex || undefined,
          exclude_types: debouncedKey.exclude_types,
          rename_rules: [],
        },
      }),
    enabled: !!id && !!draft,
  });
}

export function useGeneratedPreview(id: string, target: "clash" | "surge", enabled: boolean) {
  return useQuery<{ target: string; text: string; warnings: string[]; node_count: number }>({
    queryKey: ["preview", id, target],
    queryFn: () => api.get(`/api/profiles/${id}/preview?target=${target}`),
    enabled,
  });
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebounced(value), delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [JSON.stringify(value), delay]);
  return debounced;
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
