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
  providerRepo,
  rulesetRepo,
  proxyGroupRepo,
  generalPresetRepo,
  surgeModuleRepo,
} from "../storage/repos.js";
import type { Repo } from "../storage/repo.js";
import type { RuleSet } from "../schemas/ruleset.js";
import type { ProxyGroup } from "../schemas/proxy-group.js";
import type { SurgeModule } from "../schemas/surge-module.js";
import type { Provider } from "../schemas/provider.js";
import { nodesToInlineContent } from "../import/serialize-nodes.js";
import { logger } from "../logger.js";

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
    logger.debug(
      {
        kind,
        fileName: fileName ?? null,
        nodes: result.manualNodes.length,
        ruleSets: result.ruleSets.length,
        groups: result.proxyGroups.length,
        modules: result.modules?.length ?? 0,
        hasGeneral: !!result.general,
      },
      "Import preview",
    );
    return c.json({ kind, ...redact(result) });
  }
  if (kind === "clash") {
    const result = importClashYaml(text, fileName);
    logger.debug(
      {
        kind,
        fileName: fileName ?? null,
        nodes: result.manualNodes.length,
        ruleSets: result.ruleSets.length,
        groups: result.proxyGroups.length,
        hasGeneral: !!result.general,
      },
      "Import preview",
    );
    return c.json({ kind, ...redact(result) });
  }
  return c.json({ error: "unable to detect format; specify kind=clash|surge" }, 400);
});

interface CommitStats {
  general: number;
  general_skipped: number;
  /** 写入新 inline Provider 的去重后节点数(单次导入 = 1 个 Provider) */
  nodes: number;
  /** 已在现有节点池中存在,被丢弃的节点数 */
  nodes_skipped: number;
  rules: number;
  rules_skipped: number;
  groups: number;
  groups_skipped: number;
  modules: number;
  modules_skipped: number;
  /** 创建的新 Provider 数(目前一次导入最多 1 个,kept=0 时为 0) */
  providers: number;
  /** 新创建的 Provider id 列表(便于前端跳到节点源页) */
  provider_ids: string[];
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
    nodes: 0,
    nodes_skipped: 0,
    rules: 0,
    rules_skipped: 0,
    groups: 0,
    groups_skipped: 0,
    modules: 0,
    modules_skipped: 0,
    providers: 0,
    provider_ids: [],
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
    // 新流程: 不再写入 manual-nodes.yaml,而是把"经过 dedup 还存活的节点"包成一个
    // 全新的 inline 类型 Provider 落库。这样导入产物在 UI 上成为一等公民,可单独
    // 启用/禁用/删除/编辑,行为与手动新建 inline Provider 完全一致。
    //
    // dedup 仍然跨"全部启用 Provider 的节点池"做一次,保证再次导入同一份文件不会
    // 产生重复节点(用户问"也要记得做重复校验"对应这里)。
    const { nodes: poolNodes } = await buildNodePool();
    const { kept, duplicates } = dedupAgainstPool(result.manualNodes, poolNodes);

    if (kept.length > 0) {
      const { content, warnings: serializeWarnings } = nodesToInlineContent(
        kept,
        kind as "clash" | "surge",
      );
      for (const w of serializeWarnings) result.warnings.push(w);

      const taken = new Set((await providerRepo.list()).map((e) => e.data.id));
      const desiredSlug = trimmedFileSlug(fileName) ?? kind;
      const id = ensureUniqueId(generateImportedId(desiredSlug), taken);
      const niceLabel = trimmedFileSlug(fileName)
        ? fileName!.trim()
        : kind === "surge"
        ? "Surge import"
        : "Clash import";
      const provider: Provider = {
        id,
        name: `Imported from ${niceLabel}`,
        type: "inline",
        content,
        parser_hint: kind === "surge" ? "surge" : "clash",
        user_agent: "Surge/2400",
        // inline 类型在 UI / 调度器都不会"上游刷新",标记 never 让 cron 跳过、UI 隐藏刷新按钮
        refresh: { interval: "never" },
        enabled: true,
        tags: ["imported"],
        clash_proxy_provider: {
          enabled: false,
          health_check_url: "http://www.gstatic.com/generate_204",
          health_check_interval: 300,
        },
      };
      await providerRepo.save(provider);
      stats.providers = 1;
      stats.provider_ids.push(id);
    }
    stats.nodes = kept.length;
    stats.nodes_skipped = duplicates.length;

    if (duplicates.length > 0) {
      const sample = duplicates
        .slice(0, 5)
        .map((n) => n.name)
        .join(", ");
      const tail = duplicates.length > 5 ? `, …+${duplicates.length - 5}` : "";
      result.warnings.push(
        `Skipped ${duplicates.length} duplicate node(s) already in pool: ${sample}${tail}`,
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

  logger.info(
    {
      kind,
      fileName: fileName ?? null,
      stats,
      warningCount: result.warnings.length,
    },
    "Import committed",
  );
  if (result.warnings.length > 0) {
    logger.warn(
      { kind, count: result.warnings.length, warnings: result.warnings },
      "Import warnings",
    );
  }

  return c.json({ ok: true, stats, warnings: result.warnings });
});

function autoDetectKind(text: string): string | null {
  if (/^\[General\]/im.test(text)) return "surge";
  if (/^\s*proxies\s*:/m.test(text) || /^\s*proxy-groups\s*:/m.test(text)) return "clash";
  return null;
}

/** 把文件名(可能含路径/扩展名)收成 slug 用于 Provider id;无内容时返回 null */
function trimmedFileSlug(fileName: string | undefined): string | null {
  const trimmed = fileName?.trim();
  if (!trimmed) return null;
  return trimmed;
}

function redact(result: { manualNodes: unknown[]; ruleSets: unknown[]; proxyGroups: unknown[]; warnings?: string[]; general?: unknown; modules?: unknown[] }) {
  return {
    counts: {
      // 字段名 `nodes` 反映"导入产物的原始节点数",前端会展示为"X 个节点 → 新建为静态节点源"
      nodes: result.manualNodes.length,
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
