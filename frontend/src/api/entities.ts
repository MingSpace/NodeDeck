import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export type EntityKind = "providers" | "rules" | "groups" | "generals" | "modules" | "profiles";

interface EntityListResponse<T> {
  items: T[];
}

export function useEntityList<T>(kind: EntityKind) {
  return useQuery<EntityListResponse<T>>({
    queryKey: ["entities", kind],
    queryFn: () => api.get<EntityListResponse<T>>(`/api/entities/${kind}`),
  });
}

export function useEntity<T>(kind: EntityKind, id: string | undefined) {
  return useQuery<T>({
    queryKey: ["entities", kind, id],
    queryFn: () => api.get<T>(`/api/entities/${kind}/${id}`),
    enabled: !!id,
  });
}

export function useSaveEntity<T extends { id: string }>(kind: EntityKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: T) => api.put<T>(`/api/entities/${kind}/${data.id}`, data),
    onSuccess: (_, data) => {
      void qc.invalidateQueries({ queryKey: ["entities", kind] });
      void qc.invalidateQueries({ queryKey: ["entities", kind, data.id] });
      // providers 的派生 query(["providers", "status"]、["providers", id, "nodes"])
      // 在编辑后必须同步失效,否则节点数 / 错误徽标 / 展开面板里的节点列表会停在旧值。
      if (kind === "providers") {
        void qc.invalidateQueries({ queryKey: ["providers"] });
      }
    },
  });
}

// 与 backend/src/refs/entity-references.ts 的 EntityReference 保持同步
export interface EntityReference {
  from_kind: "profiles" | "groups" | "generals" | "rules" | "notification";
  from_id: string;
  from_name: string;
  field: string;
  via: "id" | "name";
  value: string;
  /** false = 只影响 UI 展示/默认值,不阻止删除 */
  blocking: boolean;
}

/**
 * 批量查"谁在引用这些条目"。删除前的预检:引用状态随时可能被其它页面改掉,
 * 所以不缓存(gcTime: 0),每次打开确认弹窗都重新拉。
 */
export function useEntityReferences(kind: EntityKind, ids: string[], enabled: boolean) {
  const sortedIds = [...ids].sort();
  return useQuery<Record<string, EntityReference[]>>({
    queryKey: ["entity-references", kind, sortedIds.join(",")],
    queryFn: async () => {
      const entries = await Promise.all(
        sortedIds.map(async (id) => {
          const res = await api.get<{ references: EntityReference[] }>(
            `/api/entities/${kind}/${encodeURIComponent(id)}/references`,
          );
          return [id, res.references] as const;
        }),
      );
      return Object.fromEntries(entries);
    },
    enabled: enabled && sortedIds.length > 0,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useDeleteEntity(kind: EntityKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/entities/${kind}/${id}`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["entities", kind] });
      if (kind === "providers") {
        void qc.invalidateQueries({ queryKey: ["providers"] });
      }
    },
  });
}

export interface BulkDeleteResult {
  succeeded: string[];
  failed: { id: string; error: string }[];
}

// 批量删除:后端没有提供批量接口,前端用 Promise.allSettled 并发调用单个 DELETE,
// 把成功 / 失败拆开返回,UI 可据此提示部分失败的具体 id。
export function useDeleteEntitiesBulk(kind: EntityKind) {
  const qc = useQueryClient();
  return useMutation<BulkDeleteResult, Error, string[]>({
    mutationFn: async (ids) => {
      const results = await Promise.allSettled(
        ids.map((id) => api.delete(`/api/entities/${kind}/${id}`).then(() => id)),
      );
      const succeeded: string[] = [];
      const failed: { id: string; error: string }[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") {
          succeeded.push(ids[i]);
        } else {
          failed.push({ id: ids[i], error: String(r.reason?.message ?? r.reason ?? "unknown") });
        }
      });
      return { succeeded, failed };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["entities", kind] });
      if (kind === "providers") {
        void qc.invalidateQueries({ queryKey: ["providers"] });
      }
    },
  });
}
