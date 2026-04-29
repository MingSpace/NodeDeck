import { readFile, writeFile, mkdir, rename, stat, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, basename, join } from "node:path";
import yaml from "js-yaml";
import { logger } from "../logger.js";

export interface FileEntry<T> {
  id: string;
  path: string;
  mtimeMs: number;
  data: T;
}

export async function readYaml<T>(path: string): Promise<{ data: T; mtimeMs: number } | null> {
  if (!existsSync(path)) return null;
  const text = await readFile(path, "utf8");
  const stats = await stat(path);
  const data = yaml.load(text, { schema: yaml.JSON_SCHEMA }) as T;
  return { data, mtimeMs: stats.mtimeMs };
}

export async function writeYaml(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const text = yaml.dump(data, {
    noRefs: true,
    lineWidth: 200,
    sortKeys: false,
    quotingType: '"',
    forceQuotes: false,
  });
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}

export async function listYamlFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && (e.name.endsWith(".yaml") || e.name.endsWith(".yml")))
    .map((e) => join(dir, e.name));
}

export async function deleteYaml(path: string): Promise<void> {
  if (existsSync(path)) {
    await unlink(path);
  }
}

export function fileIdFromPath(path: string): string {
  const base = basename(path);
  return base.replace(/\.ya?ml$/, "");
}

export async function readJson<T>(path: string): Promise<T | null> {
  if (!existsSync(path)) return null;
  try {
    const text = await readFile(path, "utf8");
    return JSON.parse(text) as T;
  } catch (err) {
    logger.warn({ err, path }, "Failed to read JSON file");
    return null;
  }
}

export async function writeJson(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const text = JSON.stringify(data, null, 2);
  const tmp = `${path}.${process.pid}.tmp`;
  await writeFile(tmp, text, "utf8");
  await rename(tmp, path);
}
