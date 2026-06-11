import chokidar, { type FSWatcher } from "chokidar";
import { relative, resolve } from "node:path";
import { env } from "../env.js";
import { logger } from "../logger.js";
import { invalidate, invalidateAll } from "./cache.js";
import { SUBDIRS } from "./paths.js";

let watcher: FSWatcher | null = null;

const SUBDIR_SET: ReadonlySet<string> = new Set(SUBDIRS);

/**
 * 把 chokidar 回调里的 path 反推为 (cacheNamespace, key)。
 * 路径形态:
 *   - <DATA_DIR>/<sub>/<id>.yaml   → ("repo:<sub>", "<id>")
 *   - <DATA_DIR>/config.yaml       → ("app-config", undefined)  整段 namespace 清空
 *   - 其它(嵌套子目录 / 非 yaml)   → null,由 caller 决定是否兜底
 *
 * 用 resolve+relative 规范化,兼容传入的相对/绝对 path 与 OS 路径分隔符。
 */
function classifyPath(path: string): { ns: string; key?: string } | null {
  if (!path.endsWith(".yaml") && !path.endsWith(".yml")) return null;
  const rel = relative(resolve(env.DATA_DIR), resolve(path));
  if (!rel || rel.startsWith("..")) return null;
  const parts = rel.split(/[\\/]/);
  if (parts.length === 1 && parts[0] === "config.yaml") {
    return { ns: "app-config" };
  }
  if (parts.length === 1 && parts[0] === "notification.yaml") {
    return { ns: "notification-config" };
  }
  if (parts.length === 2) {
    const [sub, file] = parts;
    if (SUBDIR_SET.has(sub) && sub !== "cache") {
      return { ns: `repo:${sub}`, key: file.replace(/\.ya?ml$/, "") };
    }
  }
  return null;
}

export function startWatcher(): void {
  if (watcher) return;
  watcher = chokidar.watch(env.DATA_DIR, {
    persistent: true,
    ignoreInitial: true,
    ignored: [/node_modules/, /\.git/, /\/cache\//],
    awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
  });

  const onChange = (path: string) => {
    const target = classifyPath(path);
    if (!target) {
      // 嵌套子目录 / 未识别布局 → 兜底全清,保证正确性优先于性能。
      if (path.endsWith(".yaml") || path.endsWith(".yml")) {
        logger.debug({ path }, "Unrecognized yaml path, falling back to full invalidate");
        invalidateAll();
      }
      return;
    }
    logger.debug({ path, ns: target.ns, key: target.key }, "Data file changed, invalidating cache");
    invalidate(target.ns, target.key);
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
