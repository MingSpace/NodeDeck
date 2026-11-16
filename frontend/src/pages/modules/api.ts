import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

// 与 backend/src/routes/module-actions.ts 保持同步
export interface RemoteCacheSummary {
  status: "ok" | "error";
  /** 最近一次尝试拉取 */
  fetched_at: number;
  /** 当前内容是什么时候拿到的 */
  ok_at?: number;
  error?: string;
  bytes?: number;
  name?: string;
  desc?: string;
  sections?: string[];
}

export interface ModuleStatus {
  id: string;
  source: "local" | "remote";
  /** 公开安装地址 /module/<id>.sgmodule(无需 token) */
  url: string;
  /** surge:///install-module?url=... */
  install_url: string;
  /** 仅远程模块;null = 还没拉过 */
  remote?: RemoteCacheSummary | null;
}

export interface ModuleTestFetchResult {
  ok: boolean;
  duration_ms: number;
  error?: string;
  bytes?: number;
  name?: string;
  desc?: string;
  arguments?: string;
  sections?: { name: string; lines: number }[];
  text?: string;
}

// queryKey 挂在 ["entities", "modules"] 下:保存 / 删除模块时 useSaveEntity 的前缀失效会顺带刷新它
const STATUS_KEY = ["entities", "modules", "status"] as const;

export function useModuleStatus() {
  return useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => api.get<{ items: ModuleStatus[] }>("/api/modules/status"),
    // 新建 / 改了 URL 的远程模块由后端在后台拉取,结果出来前每 2 秒看一次
    refetchInterval: (q) =>
      q.state.data?.items.some((m) => m.source === "remote" && m.remote === null) ? 2000 : false,
  });
}

export function useRefreshModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ id: string; remote: RemoteCacheSummary | null }>(`/api/modules/${encodeURIComponent(id)}/refresh`),
    onSettled: () => void qc.invalidateQueries({ queryKey: STATUS_KEY }),
  });
}

export function useModuleTestFetch() {
  return useMutation({
    mutationFn: (input: { url: string; fetch_via: string[] }) =>
      api.post<ModuleTestFetchResult>("/api/modules/test-fetch", input),
  });
}
