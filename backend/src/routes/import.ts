import { Hono } from "hono";
import { importSurgeConf } from "../import/surge.js";
import { importClashYaml } from "../import/clash.js";
import {
  dedupAgainstPool,
  dedupBy,
  rulesetIdentity,
  proxyGroupIdentity,
  surgeModuleIdentity,
  generalPresetIdentity,
} from "../import/dedup-pool.js";
import { generateImportedId } from "../import/id.js";
import { buildNodePool } from "../providers/pool.js";
import {
  rulesetRepo,
  proxyGroupRepo,
  generalPresetRepo,
  surgeModuleRepo,
} from "../storage/repos.js";
import type { Repo } from "../storage/repo.js";
import { readManualNodes, writeManualNodes } from "../storage/manual-nodes.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { SurgeModule } from "../schemas/surge-module.js";

export const importRouter = new Hono();

importRouter.post("/preview", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.text !== "string") {
    return c.json({ error: "expected { text, kind?, file_name? }" }, 400);
  }
  const text = body.text as string;
  const kind = (body.kind as string) ?? autoDetectKind(text);
  const fileName = typeof body.file_name === "string" ? body.file_name : undefined;
  if (kind === "surge") {
    const result = importSurgeConf(text, fileName);
    return c.json({ kind, ...redact(result) });
  }
  if (kind === "clash") {
    const result = importClashYaml(text, fileName);
    return c.json({ kind, ...redact(result) });
  }
  return c.json({ error: "unable to detect format; specify kind=clash|surge" }, 400);
});

interface CommitStats {
  general: number;
  general_skipped: number;
  manual_nodes: number;
  manual_nodes_skipped: number;
  rules: number;
  rules_skipped: number;
  groups: number;
  groups_skipped: number;
  modules: number;
  modules_skipped: number;
  providers: number;
}

importRouter.post("/commit", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid body" }, 400);
  const text = body.text as string;
  const kind = (body.kind as string) ?? autoDetectKind(text);
  const fileName = typeof body.file_name === "string" ? body.file_name : undefined;
  const opts = body.options ?? {
    import_general: true,
    import_nodes: true,
    import_rules: true,
    import_groups: true,
    import_modules: true,
  };

  let result: ReturnType<typeof importSurgeConf> | ReturnType<typeof importClashYaml>;
  if (kind === "surge") result = importSurgeConf(text, fileName);
  else if (kind === "clash") result = importClashYaml(text, fileName);
  else return c.json({ error: "unable to detect format" }, 400);

  const stats: CommitStats = {
    general: 0,
    general_skipped: 0,
    manual_nodes: 0,
    manual_nodes_skipped: 0,
    rules: 0,
    rules_skipped: 0,
    groups: 0,
    groups_skipped: 0,
    modules: 0,
    modules_skipped: 0,
    providers: 0,
  };

  // 通用预设:作为单条实体走"按内容去重 → 无等价物则分配新 id"流程,
  // 避免每次再导入同一份配置都覆盖掉用户在 Web UI 里手改过的 imported.yaml。
  if (opts.import_general && result.general) {
    const existing = (await generalPresetRepo.list()).map((e) => e.data);
    const incomingIdentity = generalPresetIdentity(result.general);
    const dup = existing.find((g) => generalPresetIdentity(g) === incomingIdentity);
    if (dup) {
      stats.general_skipped = 1;
      result.warnings.push(
        `Skipped general preset (already present as "${dup.id}" with identical settings).`,
      );
    } else {
      const taken = new Set(existing.map((e) => e.id));
      const id = ensureUniqueId(result.general.id, taken);
      await generalPresetRepo.save({ ...result.general, id });
      stats.general = 1;
    }
  }

  if (opts.import_nodes && result.manualNodes.length > 0) {
    const { nodes: poolNodes } = await buildNodePool({ includeManual: true });
    const { kept, duplicates } = dedupAgainstPool(result.manualNodes, poolNodes);

    if (kept.length > 0) {
      const existing = await readManualNodes();
      const merged = [...existing.nodes, ...kept];
      await writeManualNodes({ nodes: merged });
    }
    stats.manual_nodes = kept.length;
    stats.manual_nodes_skipped = duplicates.length;

    if (duplicates.length > 0) {
      const sample = duplicates
        .slice(0, 5)
        .map((n) => n.name)
        .join(", ");
      const tail = duplicates.length > 5 ? `, …+${duplicates.length - 5}` : "";
      result.warnings.push(
        `Skipped ${duplicates.length} duplicate node(s) already in pool (manual or provider): ${sample}${tail}`,
      );
    }
  }

  if (opts.import_rules) {
    const { saved, skipped } = await importEntitiesWithDedup<RuleSet>(
      result.ruleSets,
      rulesetRepo as Repo<never, RuleSet>,
      rulesetIdentity,
      (r) => r.name,
    );
    stats.rules = saved;
    stats.rules_skipped = skipped.length;
    pushSkippedWarning(result.warnings, "rule(s)", skipped);
  }

  if (opts.import_groups) {
    const { saved, skipped } = await importEntitiesWithDedup<ProxyGroup>(
      result.proxyGroups,
      proxyGroupRepo as Repo<never, ProxyGroup>,
      proxyGroupIdentity,
      (g) => g.name,
    );
    stats.groups = saved;
    stats.groups_skipped = skipped.length;
    pushSkippedWarning(result.warnings, "proxy-group(s)", skipped);
  }

  if (kind === "surge" && opts.import_modules) {
    const surgeRes = result as ReturnType<typeof importSurgeConf>;
    const { saved, skipped } = await importEntitiesWithDedup<SurgeModule>(
      surgeRes.modules,
      surgeModuleRepo as Repo<never, SurgeModule>,
      surgeModuleIdentity,
      (m) => m.name,
    );
    stats.modules = saved;
    stats.modules_skipped = skipped.length;
    pushSkippedWarning(result.warnings, "module(s)", skipped);
  }

  return c.json({ ok: true, stats, warnings: result.warnings });
});

function autoDetectKind(text: string): string | null {
  if (/^\[General\]/im.test(text)) return "surge";
  if (/^\s*proxies\s*:/m.test(text) || /^\s*proxy-groups\s*:/m.test(text)) return "clash";
  return null;
}

function redact(result: { manualNodes: unknown[]; ruleSets: unknown[]; proxyGroups: unknown[]; warnings?: string[]; general?: unknown; modules?: unknown[] }) {
  return {
    counts: {
      manual_nodes: result.manualNodes.length,
      rule_sets: result.ruleSets.length,
      proxy_groups: result.proxyGroups.length,
      modules: result.modules?.length ?? 0,
      has_general: !!result.general,
    },
    sample: {
      first_node: result.manualNodes[0],
      first_ruleset: result.ruleSets[0],
      first_group: result.proxyGroups[0],
    },
    warnings: result.warnings ?? [],
  };
}

/**
 * 通用导入子流程:把待导入的实体列表与已有 repo 中的条目按 identity 去重,
 * 对未命中的条目生成不冲突的 id 后写入。
 *
 * 关键不变量:
 * - 永远不会"覆盖已有同 id 的不同实体"。冲突 id 自动加 nanoid 后缀。
 * - 同一份文件二次导入时,所有条目都会被识别为重复并跳过(stats.kept = 0)。
 */
async function importEntitiesWithDedup<T extends { id: string }>(
  toImport: T[],
  repo: Repo<never, T>,
  identity: (x: Partial<T>) => string,
  describe: (x: T) => string,
): Promise<{ saved: number; skipped: T[] }> {
  if (toImport.length === 0) return { saved: 0, skipped: [] };

  const existing = (await repo.list()).map((e) => e.data);
  const { kept, duplicates } = dedupBy(toImport, existing, identity);
  const taken = new Set(existing.map((e) => e.id));

  let saved = 0;
  for (const item of kept) {
    const id = ensureUniqueId(item.id, taken);
    taken.add(id);
    await repo.save({ ...item, id });
    saved++;
  }
  return { saved, skipped: duplicates.map((d) => ({ ...d, name: describe(d) })) };
}

/**
 * 给定 importer 推断出的 desired id:
 * - 不冲突 → 直接保留(已带 6 位 nanoid 后缀,几乎一定独一无二);
 * - 与 repo 中已有 id 撞了(用户手建过同 id 的资源,或同一 commit 内部撞) → 用同样的
 *   `imported-<slug>-<nanoid>` 工厂重新摇一个,避免覆盖已有条目。
 *
 * 永远只返回 `imported-...` 形式的 id;不会写出 desired 之外的"前缀+后缀"杂交体,
 * 让前端 / 文件夹里的 imported 资源始终保持统一命名风格。
 */
function ensureUniqueId(desired: string, taken: Set<string>): string {
  if (!taken.has(desired)) return desired;
  const slug = extractSlug(desired);
  for (let i = 0; i < 5; i++) {
    const candidate = generateImportedId(slug);
    if (!taken.has(candidate)) return candidate;
  }
  // 5 次都撞(概率极低,基本只发生在 unit test 里被 mock 的 nanoid 上),fallback 拼时间戳。
  return `imported-${slug ? `${slug}-` : ""}${Date.now().toString(36)}`;
}

/** 从 `imported-<slug>-<nanoid6>` 反推 slug;无 slug 时返回空串。 */
function extractSlug(id: string): string {
  const m = id.match(/^imported-(.+)-[0-9a-z]{6}$/);
  return m ? m[1] : "";
}

function pushSkippedWarning(warnings: string[], label: string, skipped: { name?: string; id?: string }[]): void {
  if (skipped.length === 0) return;
  const sample = skipped
    .slice(0, 5)
    .map((s) => s.name ?? s.id ?? "?")
    .join(", ");
  const tail = skipped.length > 5 ? `, …+${skipped.length - 5}` : "";
  warnings.push(
    `Skipped ${skipped.length} duplicate ${label} (already present with identical content): ${sample}${tail}`,
  );
}
