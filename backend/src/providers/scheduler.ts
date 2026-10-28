import cron from "node-cron";
import { providerRepo } from "../storage/repos.js";
import { refreshProvider } from "./load.js";
import { logger } from "../logger.js";

let started = false;
let task: cron.ScheduledTask | null = null;
// 还在拉的节点源:失败状态要等这次拉完才写进 cache,期间下一个 tick(或启动时那次和第一个 tick)
// 读到的还是旧 cache,会对同一个机场再发一轮「线路 × UA」请求。拉一次可能超过一分钟(多条线路逐个超时)。
const inFlight = new Set<string>();

/**
 * Run once per minute. Each provider is refreshed when its `refresh.interval` bucket
 * (4h / 12h / 24h / 1week) has elapsed since last successful fetch.
 * never(手动刷新)走 short-circuit 路径,on_request 由 /sub 触发。
 */
export function startProviderScheduler(): void {
  if (started) return;
  started = true;
  // Every minute, scan providers and refresh those due for update
  task = cron.schedule("*/1 * * * *", () => {
    void runSchedulerTick();
  });
  logger.info("Provider scheduler started (1-min tick)");
  // Kick once on startup (best-effort, do not block bootstrap)
  void runSchedulerTick().catch((err) => logger.warn({ err }, "Initial refresh failed"));
}

export async function stopProviderScheduler(): Promise<void> {
  if (task) {
    task.stop();
    task = null;
  }
  started = false;
}

export async function runSchedulerTick(): Promise<void> {
  const all = await providerRepo.list();
  const targets = all.filter(
    (e) =>
      e.data.enabled &&
      !inFlight.has(e.id) &&
      // on_request 由 /sub 触发,cron 不主动拉,避免无人访问也消耗机场配额。
      e.data.refresh.interval !== "on_request",
    // never(手动刷新)仍进 refreshProvider:无 cache 时拉一次种子,有 ok cache 时内部 short-circuit(non-force 路径)。
  );
  logger.debug({ candidates: targets.length, total: all.length }, "Scheduler tick");
  // 并发拉取:个人用机场数量不多(<=10),全并发即可。单机场失败不影响其它,异常已就地降级到 stale。
  const results = await Promise.allSettled(
    targets.map((entry) => {
      inFlight.add(entry.id);
      return refreshProvider(entry.data, { force: false }).finally(() => inFlight.delete(entry.id));
    }),
  );
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      logger.warn({ err: r.reason, providerId: targets[i].id }, "Scheduled refresh error");
    }
  });
}
