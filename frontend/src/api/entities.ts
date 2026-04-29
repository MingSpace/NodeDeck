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
    },
  });
}

export function useDeleteEntity(kind: EntityKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/entities/${kind}/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["entities", kind] });
    },
  });
}
