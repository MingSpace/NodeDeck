import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { env } from "../env.js";

export const SUBDIRS = [
  "providers",
  "rules",
  "groups",
  "modules",
  "general",
  "profiles",
  "cache",
] as const;

export type SubDir = (typeof SUBDIRS)[number];

export async function ensureDataDirs(dataDir: string): Promise<void> {
  await mkdir(resolve(dataDir), { recursive: true });
  for (const sub of SUBDIRS) {
    await mkdir(resolve(dataDir, sub), { recursive: true });
  }
}

export function dataPath(...segments: string[]): string {
  return resolve(env.DATA_DIR, ...segments);
}

export function configPath(): string {
  return dataPath("config.yaml");
}

export function notificationConfigPath(): string {
  return dataPath("notification.yaml");
}

export function entityDir(sub: SubDir): string {
  return dataPath(sub);
}

export function entityPath(sub: SubDir, id: string): string {
  return dataPath(sub, `${id}.yaml`);
}

export function cachePath(providerId: string): string {
  return dataPath("cache", `${providerId}.json`);
}

/**
 * 日志落盘目录。不放进 SUBDIRS:它不是实体目录(没有 repo / 不参与 chokidar 缓存失效),
 * 由 log-store 在首次写入时按需创建。
 */
export function logsDir(): string {
  return dataPath("logs");
}

/** @param day 本地日期,格式 YYYY-MM-DD */
export function logFilePath(day: string): string {
  return dataPath("logs", `${day}.log`);
}
