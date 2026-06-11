import { dataPath } from "../storage/paths.js";
import { readJson, writeJson } from "../storage/yaml-io.js";

/**
 * 通知去重/冷却状态:{ [eventKey]: lastSentAt(ms) }。
 * 落盘到 data/cache/notification-state.json,重启后冷却窗口仍然有效。
 * 单进程内通过 in-memory 副本 + 串行写队列避免并发刷新时互相覆盖。
 */
const STATE_FILE = "notification-state.json";

let stateCache: Record<string, number> | null = null;
let persistQueue: Promise<void> = Promise.resolve();

function statePath(): string {
  return dataPath("cache", STATE_FILE);
}

async function loadState(): Promise<Record<string, number>> {
  if (stateCache) return stateCache;
  const raw = await readJson<Record<string, number>>(statePath());
  stateCache = raw && typeof raw === "object" ? raw : {};
  return stateCache;
}

function persist(): void {
  const snapshot = { ...(stateCache ?? {}) };
  persistQueue = persistQueue.then(() => writeJson(statePath(), snapshot)).catch(() => undefined);
}

/**
 * 冷却检查 + 记录:若 key 不在冷却期内则记录当前时间并返回 true(允许发送)。
 */
export async function shouldSend(key: string, cooldownMs: number, now = Date.now()): Promise<boolean> {
  const state = await loadState();
  const last = state[key];
  if (typeof last === "number" && now - last < cooldownMs) {
    return false;
  }
  state[key] = now;
  persist();
  return true;
}

/** 清除指定前缀的所有状态(如 provider 恢复后清掉它的失败/告警冷却)。 */
export async function clearStateByPrefix(prefix: string): Promise<void> {
  const state = await loadState();
  let changed = false;
  for (const key of Object.keys(state)) {
    if (key.startsWith(prefix)) {
      delete state[key];
      changed = true;
    }
  }
  if (changed) persist();
}

export async function clearStateKey(key: string): Promise<void> {
  const state = await loadState();
  if (key in state) {
    delete state[key];
    persist();
  }
}

/** 仅测试用:重置内存副本。 */
export function __resetStateForTest(initial?: Record<string, number>): void {
  stateCache = initial ?? null;
  persistQueue = Promise.resolve();
}
