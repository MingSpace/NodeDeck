import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { manualNodesPath } from "./paths.js";
import { readYaml, writeYaml } from "./yaml-io.js";
import { manualNodesSchema, type ManualNodes } from "../schemas/node.js";
import { getCache, setCache, invalidate } from "./cache.js";
import { logger } from "../logger.js";

const CACHE_NS = "manual-nodes";
const CACHE_KEY = "single";

export async function readManualNodes(): Promise<ManualNodes> {
  const path = manualNodesPath();
  if (!existsSync(path)) return { nodes: [] };
  const stats = await stat(path);
  const cached = getCache<ManualNodes>(CACHE_NS, CACHE_KEY, stats.mtimeMs);
  if (cached) return cached;
  const raw = await readYaml<unknown>(path);
  if (!raw) return { nodes: [] };
  const result = manualNodesSchema.safeParse(raw.data);
  if (!result.success) {
    logger.warn({ errors: result.error.flatten() }, "manual-nodes.yaml invalid; treating as empty");
    return { nodes: [] };
  }
  setCache<ManualNodes>(CACHE_NS, CACHE_KEY, raw.mtimeMs, result.data);
  return result.data;
}

export async function writeManualNodes(data: ManualNodes): Promise<void> {
  const parsed = manualNodesSchema.parse(data);
  await writeYaml(manualNodesPath(), parsed);
  invalidate(CACHE_NS);
}
