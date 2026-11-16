import { rename as fsRename } from "node:fs/promises";
import type { ZodTypeAny } from "zod";
import type { Repo } from "../storage/repo.js";
import {
  egressRepo,
  generalPresetRepo,
  profileRepo,
  providerRepo,
  proxyGroupRepo,
  rulesetRepo,
  surgeModuleRepo,
} from "../storage/repos.js";
import { loadNotificationConfig, saveNotificationConfig } from "../storage/notification-store.js";
import { cachePath, moduleCachePath } from "../storage/paths.js";
import { logger } from "../logger.js";
import { findEntityReferences, type EntityReference, type ReferenceableKind } from "./entity-references.js";

/**
 * 实体改 id(= 改文件名主键),并把所有「按 id 引用它」的地方一起改掉。
 *
 * 「谁引用了它」完全复用 entity-references.ts 的反向索引(删除前检查用的同一份),只取 via=id 的引用,
 * 按其 field 路径原地替换 —— 新增跨实体引用字段时只需在那边加扫描分支,改名自动跟上。
 * 按 name 的引用(策略组名等)与 id 无关,不动。
 *
 * 文件系统没有事务,顺序保证任何时刻都没有悬空引用:
 *   写新文件 → 改引用方 → 搬缓存 → 删旧文件
 * 中途失败时旧文件还在,最坏是新旧两份并存,引用仍然可解析。
 *
 * Profile 不支持改 id:它的 id 写在客户端的订阅链接里,改了所有设备的订阅都会失效。
 */
export const RENAMEABLE_KINDS = ["providers", "rules", "groups", "generals", "modules", "egresses"] as const;
export type RenameableKind = (typeof RENAMEABLE_KINDS)[number] & ReferenceableKind;

export function isRenameableKind(kind: string): kind is RenameableKind {
  return (RENAMEABLE_KINDS as readonly string[]).includes(kind);
}

export class RenameError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

type AnyRepo = Repo<ZodTypeAny, { id: string } & Record<string, unknown>>;

const REPOS: Record<RenameableKind | "profiles", AnyRepo> = {
  providers: providerRepo as unknown as AnyRepo,
  rules: rulesetRepo as unknown as AnyRepo,
  groups: proxyGroupRepo as unknown as AnyRepo,
  generals: generalPresetRepo as unknown as AnyRepo,
  modules: surgeModuleRepo as unknown as AnyRepo,
  egresses: egressRepo as unknown as AnyRepo,
  profiles: profileRepo as unknown as AnyRepo,
};

/** 改名后要跟着搬的派生缓存(搬不了也没关系,只是下次重新拉) */
const CACHE_PATHS: Partial<Record<RenameableKind, (id: string) => string>> = {
  providers: cachePath,
  modules: moduleCachePath,
};

/**
 * 按 `a.b[2].c` 形式的路径找到叶子,把其中等于 oldId 的值换成 newId(叶子是数组就逐项换)。
 * 返回是否真的换了。路径格式与 EntityReference.field 一致。
 */
export function replaceIdAtPath(root: unknown, path: string, oldId: string, newId: string): boolean {
  const tokens: Array<string | number> = [];
  for (const part of path.split(".")) {
    const m = /^([^[\]]+)((?:\[\d+\])*)$/.exec(part);
    if (!m) return false;
    tokens.push(m[1]);
    for (const idx of m[2].matchAll(/\[(\d+)\]/g)) tokens.push(Number(idx[1]));
  }
  let parent: unknown = root;
  for (const t of tokens.slice(0, -1)) {
    if (parent === null || typeof parent !== "object") return false;
    parent = (parent as Record<string | number, unknown>)[t];
  }
  if (parent === null || typeof parent !== "object") return false;
  const last = tokens[tokens.length - 1];
  const container = parent as Record<string | number, unknown>;
  const leaf = container[last];
  if (Array.isArray(leaf)) {
    let changed = false;
    container[last] = leaf.map((v) => {
      if (v !== oldId) return v;
      changed = true;
      return newId;
    });
    return changed;
  }
  if (leaf === oldId) {
    container[last] = newId;
    return true;
  }
  return false;
}

export interface RenameResult {
  kind: RenameableKind;
  old_id: string;
  new_id: string;
  /** 被改写的引用方(去重) */
  updated: Array<{ kind: EntityReference["from_kind"]; id: string; name: string; fields: string[] }>;
}

export async function renameEntity(kind: RenameableKind, oldId: string, newId: string): Promise<RenameResult> {
  if (oldId === newId) throw new RenameError(400, "新 id 与原 id 相同");
  const repo = REPOS[kind];
  const entry = await repo.get(oldId);
  if (!entry) throw new RenameError(404, "实体不存在");
  if (await repo.exists(newId)) throw new RenameError(409, `id「${newId}」已被占用`);

  const refs = (await findEntityReferences(kind, oldId)).filter((r) => r.via === "id");

  // 1. 新文件(schema 校验在 repo.save 里)
  await repo.save({ ...entry.data, id: newId });

  // 2. 引用方:按 (from_kind, from_id) 分组,每个只读写一次
  const groups = new Map<string, EntityReference[]>();
  for (const r of refs) {
    const key = `${r.from_kind}\n${r.from_id}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const updated: RenameResult["updated"] = [];
  for (const list of groups.values()) {
    const { from_kind, from_id, from_name } = list[0];
    const fields = list.map((r) => r.field);
    if (from_kind === "notification") {
      const cfg = structuredClone(await loadNotificationConfig());
      fields.forEach((f) => replaceIdAtPath(cfg, f, oldId, newId));
      await saveNotificationConfig(cfg);
    } else {
      const refRepo = REPOS[from_kind];
      // 自引用(理论上没有,防御):实体本身已改名,改新文件
      const targetId = from_kind === kind && from_id === oldId ? newId : from_id;
      const refEntry = await refRepo.get(targetId);
      if (!refEntry) continue;
      const data = structuredClone(refEntry.data);
      fields.forEach((f) => replaceIdAtPath(data, f, oldId, newId));
      await refRepo.save(data);
    }
    updated.push({ kind: from_kind, id: from_id, name: from_name, fields });
  }

  // 3. 派生缓存:搬过去省一次重新拉取;不存在 / 失败都无所谓
  const cacheOf = CACHE_PATHS[kind];
  if (cacheOf) {
    await fsRename(cacheOf(oldId), cacheOf(newId)).catch(() => undefined);
  }

  // 4. 删旧文件
  await repo.delete(oldId);
  logger.info({ kind, oldId, newId, updated: updated.map((u) => `${u.kind}/${u.id}`) }, "Entity renamed");
  return { kind, old_id: oldId, new_id: newId, updated };
}
