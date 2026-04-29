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

export function manualNodesPath(): string {
  return dataPath("manual-nodes.yaml");
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
