import { existsSync } from "node:fs";
import { readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "../logger.js";
import {
  dataPath,
  entityDir,
  type SubDir,
} from "./paths.js";
import { invalidateAll } from "./cache.js";
import { loadConfig, saveConfig } from "./config-store.js";

/**
 * 数据还原可选作用域。
 *
 * @business_rule 管理员账号(用户名/密码 hash/必修改密码标记)永远不会被重置,
 * 否则用户会被锁在外面无法登录。`service_settings` 仅清掉
 * `ip_allowlist` / `public_base_url` / `default_user_agent` 这些可重建的部分。
 */
export interface ResetScope {
  providers?: boolean;
  rules?: boolean;
  groups?: boolean;
  modules?: boolean;
  general?: boolean;
  profiles?: boolean;
  cache?: boolean;
  service_settings?: boolean;
}

export interface ResetResult {
  removed: {
    providers: number;
    rules: number;
    groups: number;
    modules: number;
    general: number;
    profiles: number;
    cache: number;
    service_settings: boolean;
  };
}

const ENTITY_SCOPES: Array<{ scopeKey: keyof ResetScope; sub: SubDir }> = [
  { scopeKey: "providers", sub: "providers" },
  { scopeKey: "rules", sub: "rules" },
  { scopeKey: "groups", sub: "groups" },
  { scopeKey: "modules", sub: "modules" },
  { scopeKey: "general", sub: "general" },
  { scopeKey: "profiles", sub: "profiles" },
];

/**
 * 按作用域批量删除 yaml/json 文件。
 *
 * 实现要点:
 * - 不删除目录本身,只删目录下的 .yaml/.yml(或 cache 下的 .json),`ensureDataDirs`
 *   还能继续靠这些目录工作,chokidar 也不会因目录被删而 unwatch。
 * - 完成后强制 `invalidateAll()`,防止 cache 还在响应已删除的实体内容。
 *   chokidar 的 unlink 事件本来也会触发,但显式 invalidate 可以避免请求落在事件之前。
 * - admin 账户绝对不动,只在 `service_settings: true` 时把 config.yaml 中的服务字段重置默认。
 *
 * 删除是 best-effort:遇到单个文件失败会 log 警告但继续,不因为一个文件失败而让整个还原半途而废。
 */
export async function resetData(scope: ResetScope): Promise<ResetResult> {
  const removed: ResetResult["removed"] = {
    providers: 0,
    rules: 0,
    groups: 0,
    modules: 0,
    general: 0,
    profiles: 0,
    cache: 0,
    service_settings: false,
  };

  for (const { scopeKey, sub } of ENTITY_SCOPES) {
    if (!scope[scopeKey]) continue;
    const count = await clearDir(entityDir(sub), (name) => name.endsWith(".yaml") || name.endsWith(".yml"));
    // scopeKey 与 ResetResult.removed 的数值字段一一对应,这里类型断言安全
    (removed as Record<string, number | boolean>)[scopeKey] = count;
  }

  // providers 与 cache 强耦合:删了机场配置却留着 cache,下次访问会拿到无主缓存。
  // 默认前端会把 cache 跟着 providers 一起勾选;这里再做一次显式联动以防直接调用 API 时漏勾。
  const shouldClearCache = scope.cache || scope.providers;
  if (shouldClearCache) {
    removed.cache = await clearDir(dataPath("cache"), (name) => name.endsWith(".json"));
  }

  if (scope.service_settings) {
    const cfg = await loadConfig();
    await saveConfig({
      ...cfg,
      ip_allowlist: [],
      public_base_url: undefined,
      default_user_agent: "Surge/2400",
    });
    removed.service_settings = true;
  }

  invalidateAll();
  return { removed };
}

async function clearDir(dir: string, accept: (name: string) => boolean): Promise<number> {
  if (!existsSync(dir)) return 0;
  let count = 0;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    logger.warn({ err, dir }, "Failed to readdir during reset");
    return 0;
  }
  for (const name of entries) {
    if (!accept(name)) continue;
    const full = join(dir, name);
    try {
      await unlink(full);
      count++;
    } catch (err) {
      logger.warn({ err, path: full }, "Failed to delete during reset");
    }
  }
  return count;
}
