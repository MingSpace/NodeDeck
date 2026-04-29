import cron from "node-cron";
import { providerRepo } from "../storage/repos.js";
import { refreshProvider } from "./load.js";
import { logger } from "../logger.js";

let started = false;
let task: cron.ScheduledTask | null = null;

/**
 * Run once per minute. Each provider is refreshed when its `refresh.interval_minutes` has elapsed
 * since last successful fetch.
 */
export function startProviderScheduler(): void {
  if (started) return;
  started = true;
  // Every minute, scan providers and refresh those due for update
  task = cron.schedule("*/1 * * * *", () => {
    void runOnce();
  });
  logger.info("Provider scheduler started (1-min tick)");
  // Kick once on startup (best-effort, do not block bootstrap)
  void runOnce().catch((err) => logger.warn({ err }, "Initial refresh failed"));
}

export async function stopProviderScheduler(): Promise<void> {
  if (task) {
    task.stop();
    task = null;
  }
  started = false;
}

async function runOnce(): Promise<void> {
  const all = await providerRepo.list();
  for (const entry of all) {
    if (!entry.data.enabled) continue;
    try {
      await refreshProvider(entry.data, { force: false });
    } catch (err) {
      logger.warn({ err, providerId: entry.id }, "Scheduled refresh error");
    }
  }
}
