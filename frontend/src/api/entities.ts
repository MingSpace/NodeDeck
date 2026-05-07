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
      qc.invalidateQueries({ queryKey: ["entities", kind] });
      qc.invalidateQueries({ queryKey: ["entities", kind, data.id] });
      // providers 的派生 query(["providers", "status"]、["providers", id, "nodes"])
      // 在编辑后必须同步失效,否则节点数 / 错误徽标 / 展开面板里的节点列表会停在旧值。
      if (kind === "providers") {
        qc.invalidateQueries({ queryKey: ["providers"] });
      }
    },
  });
}

export function useDeleteEntity(kind: EntityKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/entities/${kind}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entities", kind] });
      if (kind === "providers") {
        qc.invalidateQueries({ queryKey: ["providers"] });
      }
    },
  });
}
