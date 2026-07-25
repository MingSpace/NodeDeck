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
