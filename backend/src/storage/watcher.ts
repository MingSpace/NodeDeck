import chokidar, { type FSWatcher } from "chokidar";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { invalidateAll } from "./cache.js";

let watcher: FSWatcher | null = null;

export function startWatcher(): void {
  if (watcher) return;
  watcher = chokidar.watch(env.DATA_DIR, {
    persistent: true,
    ignoreInitial: true,
    ignored: [/node_modules/, /\.git/, /\/cache\//],
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
  });

  const onChange = (path: string) => {
    if (!path.endsWith(".yaml") && !path.endsWith(".yml")) return;
    logger.debug({ path }, "Data file changed, invalidating cache");
    invalidateAll();
  };

  watcher.on("add", onChange);
  watcher.on("change", onChange);
  watcher.on("unlink", onChange);
  watcher.on("ready", () => logger.info("File watcher ready"));
  watcher.on("error", (err) => logger.error({ err }, "Watcher error"));
}

export async function stopWatcher(): Promise<void> {
  if (watcher) {
    await watcher.close();
    watcher = null;
  }
}
