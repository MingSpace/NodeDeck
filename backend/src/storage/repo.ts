import { stat } from "node:fs/promises";
import type { z, ZodTypeAny } from "zod";
import { logger } from "../logger.js";
import {
  readYaml,
  writeYaml,
  listYamlFiles,
  deleteYaml,
  fileIdFromPath,
  type FileEntry,
} from "./yaml-io.js";
import { entityDir, entityPath, type SubDir } from "./paths.js";
import { getCache, setCache, invalidate } from "./cache.js";

interface RepoOptions<S extends ZodTypeAny> {
  sub: SubDir;
  schema: S;
}

export class Repo<S extends ZodTypeAny, T extends { id: string } = z.infer<S> & { id: string }> {
  constructor(private readonly opts: RepoOptions<S>) {}

  private cacheNamespace(): string {
    return `repo:${this.opts.sub}`;
  }

  async list(): Promise<FileEntry<T>[]> {
    const files = await listYamlFiles(entityDir(this.opts.sub));
    const result: FileEntry<T>[] = [];
    for (const path of files) {
      const id = fileIdFromPath(path);
      const entry = await this.readById(id, path);
      if (entry) result.push(entry);
    }
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }

  async get(id: string): Promise<FileEntry<T> | null> {
    return this.readById(id);
  }

  async exists(id: string): Promise<boolean> {
    const path = entityPath(this.opts.sub, id);
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  }

  async save(data: unknown): Promise<FileEntry<T>> {
    const parsed = this.opts.schema.parse(data) as T;
    const id = parsed.id;
    const path = entityPath(this.opts.sub, id);
    await writeYaml(path, parsed);
    invalidate(this.cacheNamespace(), id);
    return (await this.readById(id, path))!;
  }

  async delete(id: string): Promise<boolean> {
    const path = entityPath(this.opts.sub, id);
    await deleteYaml(path);
    invalidate(this.cacheNamespace(), id);
    return true;
  }

  private async readById(id: string, knownPath?: string): Promise<FileEntry<T> | null> {
    const path = knownPath ?? entityPath(this.opts.sub, id);
    let stats;
    try {
      stats = await stat(path);
    } catch {
      return null;
    }
    const cached = getCache<FileEntry<T>>(this.cacheNamespace(), id, stats.mtimeMs);
    if (cached) return cached;

    const raw = await readYaml<unknown>(path);
    if (!raw) return null;
    const result = this.opts.schema.safeParse(raw.data);
    if (!result.success) {
      logger.warn(
        { sub: this.opts.sub, id, errors: result.error.flatten() },
        "Schema validation failed; serving fallback empty entry would be wrong, skipping",
      );
      return null;
    }
    const entry: FileEntry<T> = {
      id,
      path,
      mtimeMs: raw.mtimeMs,
      data: result.data as T,
    };
    setCache<FileEntry<T>>(this.cacheNamespace(), id, raw.mtimeMs, entry);
    return entry;
  }
}
