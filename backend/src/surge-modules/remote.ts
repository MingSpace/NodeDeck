import { z } from "zod";
import type { SurgeModule } from "../schemas/surge-module.js";
import { moduleCachePath } from "../storage/paths.js";
import { readJson, writeJson } from "../storage/yaml-io.js";
import { fetchTextViaRoutes, type FetchTextOptions } from "../providers/fetcher.js";
import { logger } from "../logger.js";
import { checkModuleText } from "./sgmodule.js";

/**
 * 远程模块的内容缓存(data/cache/module.<id>.json)。只是上游的派生副本,权威仍是远程 URL 本身:
 * - 距上次尝试不到 REMOTE_MODULE_TTL_MS 直接用缓存;过期了在请求路径上同步重拉一次;
 * - 拉取失败沿用上次拿到的内容(status=error 但 text 还在),并同样按 TTL 退避,不会每个请求都打上游;
 * - URL 改了旧缓存作废。
 * 改了远程文件想立刻生效:Web UI 模块列表点「刷新」(force)。
 */
export const REMOTE_MODULE_TTL_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
// 部分模块转换服务按 UA 判断输出给哪个客户端,带上 Surge 字样拿到 Surge 语法
const USER_AGENT = "Surge NodeDeck";

const moduleCacheSchema = z.object({
  module_id: z.string(),
  url: z.string(),
  /** 最近一次尝试拉取的时间(成功或失败) */
  fetched_at: z.number(),
  status: z.enum(["ok", "error"]),
  error: z.string().optional(),
  /** 最近一次成功拿到的内容;失败时保留上一次的 */
  text: z.string().optional(),
  /** text 是什么时候拿到的 */
  ok_at: z.number().optional(),
});

export type ModuleCache = z.infer<typeof moduleCacheSchema>;

export async function readModuleCache(moduleId: string): Promise<ModuleCache | null> {
  const data = await readJson<unknown>(moduleCachePath(moduleId));
  if (!data) return null;
  const parsed = moduleCacheSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

type RemoteModule = Pick<SurgeModule, "id" | "url" | "fetch_via">;

export interface LoadRemoteOptions {
  force?: boolean;
  now?: number;
  /** 测试注入 */
  fetchText?: typeof fetchTextViaRoutes;
  loadEgress?: FetchTextOptions["loadEgress"];
}

// 同一个模块并发请求只拉一次(多个 /sub 同时过期时)
const inflight = new Map<string, Promise<ModuleCache>>();

export async function loadRemoteModule(m: RemoteModule, opts: LoadRemoteOptions = {}): Promise<ModuleCache> {
  const url = m.url?.trim() ?? "";
  const cached = await readModuleCache(m.id);
  const sameUrl = cached !== null && cached.url === url;
  const now = opts.now ?? Date.now();
  if (!opts.force && sameUrl && now - cached.fetched_at < REMOTE_MODULE_TTL_MS) return cached;

  const key = `${m.id}\n${url}`;
  const running = inflight.get(key);
  if (running) return running;
  const task = refresh(m, url, sameUrl ? cached : null, opts).finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

async function refresh(
  m: RemoteModule,
  url: string,
  previous: ModuleCache | null,
  opts: LoadRemoteOptions,
): Promise<ModuleCache> {
  const fetchText = opts.fetchText ?? fetchTextViaRoutes;
  let next: ModuleCache;
  try {
    const res = await fetchText(url, m.fetch_via, {
      userAgent: USER_AGENT,
      timeoutMs: FETCH_TIMEOUT_MS,
      check: checkModuleText,
      loadEgress: opts.loadEgress,
      logContext: { moduleId: m.id },
    });
    next = { module_id: m.id, url, fetched_at: res.fetched_at, status: "ok", text: res.text, ok_at: res.fetched_at };
    logger.info({ moduleId: m.id, bytes: res.text.length }, "Remote module fetched");
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    next = {
      module_id: m.id,
      url,
      fetched_at: opts.now ?? Date.now(),
      status: "error",
      error,
      text: previous?.text,
      ok_at: previous?.ok_at,
    };
    logger.warn({ moduleId: m.id, error, hasStale: !!previous?.text }, "Remote module fetch failed");
  }
  await writeJson(moduleCachePath(m.id), next);
  return next;
}
