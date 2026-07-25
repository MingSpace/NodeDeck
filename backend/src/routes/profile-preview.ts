import { Hono } from "hono";
import { z } from "zod";
import { profileRepo, providerRepo } from "../storage/repos.js";
import { resolveProfile } from "../generators/profile-resolver.js";
import { generateClashConfig } from "../generators/clash.js";
import { generateSurgeConfig } from "../generators/surge.js";
import { env } from "../env.js";
import { loadConfig } from "../storage/config-store.js";
import { buildNodePool } from "../providers/pool.js";
import { applyNodeFilter } from "../generators/node-filter.js";
import { sortNodesByRegion } from "../generators/node-sort.js";
import { uniquifyNodeNames, buildProviderLabels } from "../generators/node-naming.js";
import { buildGroupMemberIndex } from "../generators/group-members.js";
import {
  analyzeChainRules,
  applyChainRules,
  resolveChainPaths,
  validateChain,
  CHAIN_BUILTINS,
} from "../chain/apply.js";
import { nodeFilterSchema, profileSchema, type Profile } from "../schemas/profile.js";
import type { Provider } from "../schemas/provider.js";
import { logger } from "../logger.js";

export const profilePreviewRouter = new Hono();

const nodePoolPreviewSchema = z.object({
  providers: z.array(z.string()).default([]),
  node_filter: nodeFilterSchema.optional(),
});

const previewBodySchema = z
  .object({
    profile: z.unknown().optional(),
    target: z.enum(["clash", "surge"]).optional(),
  })
  .optional();

interface ResolvedDraft {
  profile: Profile;
  validationWarnings: string[];
}

// Best-effort 校验:草稿不合法时,合并磁盘版兜底缺失字段;仍不合法则降级到磁盘版,
// 把所有 zod issues 转成中文 warnings 让前端预览面板顶部展示。
async function resolveDraftProfile(
  id: string,
  draft: unknown,
): Promise<{ status: "ok"; result: ResolvedDraft } | { status: "not_found" }> {
  if (draft === undefined || draft === null) {
    const entry = await profileRepo.get(id);
    if (!entry) return { status: "not_found" };
    return { status: "ok", result: { profile: entry.data, validationWarnings: [] } };
  }

  const direct = profileSchema.safeParse(draft);
  if (direct.success) {
    return { status: "ok", result: { profile: direct.data, validationWarnings: [] } };
  }

  const saved = await profileRepo.get(id);
  const draftObj = (typeof draft === "object" && draft !== null ? draft : {}) as Record<string, unknown>;
  const merged = saved
    ? { ...(saved.data as Record<string, unknown>), ...draftObj, id }
    : { ...draftObj, id };

  const lenient = profileSchema.safeParse(merged);
  if (lenient.success) {
    return {
      status: "ok",
      result: {
        profile: lenient.data,
        validationWarnings: formatIssues(direct.error.issues),
      },
    };
  }

  if (saved) {
    return {
      status: "ok",
      result: {
        profile: saved.data,
        validationWarnings: [
          ...formatIssues(direct.error.issues, "(已回退到上次保存的版本)"),
        ],
      },
    };
  }

  return { status: "not_found" };
}

function formatIssues(issues: z.ZodIssue[], suffix?: string): string[] {
  return issues.map((i) => {
    const path = i.path.length > 0 ? i.path.join(".") : "(root)";
    const tail = suffix ? ` ${suffix}` : "";
    return `字段 ${path}: ${i.message}${tail}`;
  });
}

profilePreviewRouter.post("/:id/preview", async (c) => {
  const id = c.req.param("id");

  const rawBody = await c.req.json().catch(() => null);
  const parsedBody = previewBodySchema.safeParse(rawBody ?? undefined);
  if (!parsedBody.success) {
    return c.json({ error: "invalid request body", details: parsedBody.error.flatten() }, 400);
  }
  const body = parsedBody.data ?? {};

  const target = body.target ?? c.req.query("target") ?? "clash";
  if (target !== "clash" && target !== "surge") {
    return c.json({ error: "target must be clash or surge" }, 400);
  }

  const resolution = await resolveDraftProfile(id, body.profile);
  if (resolution.status === "not_found") {
    return c.json({ error: "not found" }, 404);
  }
  const { profile, validationWarnings } = resolution.result;

  // 预览走 stale-while-revalidate:有 cache(含 stale)立即返回,无 cache 的机场后台刷新、不同步等网络。
  const resolved = await resolveProfile(profile, { staleWhileRevalidate: true });
  const allWarnings = [...validationWarnings, ...resolved.warnings];
  const revalidating = (resolved.revalidating?.length ?? 0) > 0;

  if (target === "clash") {
    const text = generateClashConfig({
      profile,
      nodes: resolved.nodes,
      providers: resolved.providers,
      groups: resolved.groups,
      allKnownGroupNames: resolved.allKnownGroupNames,
      rules: resolved.rules,
      finalRule: resolved.finalRule,
      geoipFallback: resolved.geoipFallback,
      general: resolved.general,
      warnings: allWarnings,
    });
    logger.debug(
      {
        profileId: id,
        target,
        nodeCount: resolved.nodes.length,
        warningCount: allWarnings.length,
      },
      "Profile preview",
    );
    return c.json({ target, text, warnings: allWarnings, node_count: resolved.nodes.length, revalidating });
  }
  const cfg = await loadConfig();
  const baseUrl = cfg.public_base_url ?? env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const managedConfigUrl =
    profile.managed_config_url === "auto"
      ? `${baseUrl}/sub?profile=${profile.id}&target=surge&t=${profile.token}`
      : profile.managed_config_url === "none"
        ? undefined
        : profile.managed_config_url;
  const text = generateSurgeConfig({
    profile,
    nodes: resolved.nodes,
    providers: resolved.providers,
    groups: resolved.groups,
    allKnownGroupNames: resolved.allKnownGroupNames,
    rules: resolved.rules,
    finalRule: resolved.finalRule,
    geoipFallback: resolved.geoipFallback,
    general: resolved.general,
    surgeModules: resolved.surgeModules,
    managed_config_url: managedConfigUrl,
    warnings: allWarnings,
  });
  logger.debug(
    {
      profileId: id,
      target,
      nodeCount: resolved.nodes.length,
      warningCount: allWarnings.length,
    },
    "Profile preview",
  );
  return c.json({ target, text, warnings: allWarnings, node_count: resolved.nodes.length, revalidating });
});

profilePreviewRouter.get("/:id/url", async (c) => {
  const id = c.req.param("id");
  const target = c.req.query("target") ?? "clash";
  const entry = await profileRepo.get(id);
  if (!entry) return c.json({ error: "not found" }, 404);
  const cfg = await loadConfig();
  const baseUrl = cfg.public_base_url ?? env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  const url = `${baseUrl}/sub?profile=${entry.data.id}&target=${target}&t=${entry.data.token}`;
  return c.json({ url });
});

profilePreviewRouter.post("/:id/node-pool-preview", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const parsed = nodePoolPreviewSchema.safeParse(body ?? {});
  if (!parsed.success) {
    return c.json({ error: "validation failed", details: parsed.error.flatten() }, 400);
  }
  // The :id path is used for namespacing only; profile data not required for preview.
  // Caller may still pass an existing profile id for context, but providers/node_filter override it.
  void id;
  // 同 preview:节点池预览也走 SWR,无 cache 的机场后台刷新、不卡首屏。
  // providers 实体并发取:uniquify 改名时要按来源 tag/首字母算 `【标识】` 前缀,与订阅产物一致。
  const [pool, providerEntries] = await Promise.all([
    buildNodePool({
      providerIds: parsed.data.providers,
      staleWhileRevalidate: true,
    }),
    Promise.all(parsed.data.providers.map((pid) => providerRepo.get(pid))),
  ]);
  const providers: Provider[] = [];
  for (const entry of providerEntries) {
    if (entry && entry.data.enabled) providers.push(entry.data);
  }
  const filter = parsed.data.node_filter ?? {
    rename_rules: [],
    exclude_types: [],
    sort_by_region: false,
  };
  // 与 generator 入口管线保持同序(filter → sort → uniquify),预览名即订阅名。
  // Surge 端的 escapeSurgeNames 与链式改写发生在 target 相关的 generator 内,预览不做。
  const filteredRaw = applyNodeFilter(pool.nodes, filter);
  const sorted = filter.sort_by_region ? sortNodesByRegion(filteredRaw) : filteredRaw;
  const renameWarnings: string[] = [];
  const { nodes: filtered } = uniquifyNodeNames(sorted, renameWarnings, {
    providerLabels: buildProviderLabels(providers),
  });
  const byProvider: Record<string, number> = {};
  for (const [provId, nodes] of pool.byProvider) {
    byProvider[provId] = nodes.length;
  }
  logger.debug(
    {
      profileId: id,
      providerCount: parsed.data.providers.length,
      rawCount: pool.nodes.length,
      filteredCount: filtered.length,
      renamedCount: renameWarnings.length,
    },
    "Node pool preview",
  );
  return c.json({
    nodes: filtered.map((n) => ({
      name: n.name,
      type: n.type,
      server: n.server,
      port: n.port,
      region: n.region,
      level: n.level,
      line: n.line,
      source_provider_id: n.source_provider_id,
      tags: n.tags,
    })),
    count: filtered.length,
    raw_count: pool.nodes.length,
    by_provider: byProvider,
    revalidating: (pool.revalidating?.length ?? 0) > 0,
  });
});

// 每条规则回传的命中节点样例上限:UI 只用来给用户"瞄一眼命中对不对",
// 全量回传在几百节点 × 多条规则时会让响应无谓地变大。
const MATCH_SAMPLE_LIMIT = 12;
const CONFLICT_LIMIT = 30;

/**
 * 链式代理专用预览:回传每条 chain_rule 的命中/生效节点数、冲突、解析后的完整链路,
 * 以及可选作出口(via)的候选名单。UI 靠它做"改一下 selector 立刻看到影响谁"的实时反馈。
 *
 * 这里刻意复刻 generator 入口管线的前几步(filter → sort → uniquify),否则规则里写的
 * 节点名/组名与订阅产物中的名字对不上(改名前缀 `【标识】` 就是最典型的坑)。
 * Surge 端额外的 escapeSurgeNames 不在此复刻 — 它只净化 = , " 等字符,不影响命中判断。
 */
profilePreviewRouter.post("/:id/chain-preview", async (c) => {
  const id = c.req.param("id");
  const rawBody = await c.req.json().catch(() => null);
  const parsedBody = previewBodySchema.safeParse(rawBody ?? undefined);
  if (!parsedBody.success) {
    return c.json({ error: "invalid request body", details: parsedBody.error.flatten() }, 400);
  }
  const resolution = await resolveDraftProfile(id, (parsedBody.data ?? {}).profile);
  if (resolution.status === "not_found") {
    return c.json({ error: "not found" }, 404);
  }
  const { profile, validationWarnings } = resolution.result;

  const resolved = await resolveProfile(profile, { staleWhileRevalidate: true });
  const filteredRaw = applyNodeFilter(resolved.nodes, profile.node_filter);
  const sorted = profile.node_filter.sort_by_region ? sortNodesByRegion(filteredRaw) : filteredRaw;
  const uniqued = uniquifyNodeNames(sorted, [], {
    providerLabels: buildProviderLabels(resolved.providers ?? []),
    groups: resolved.groups,
  });

  const groupMembers = buildGroupMemberIndex(uniqued.groups, uniqued.nodes);
  const groupNames = new Set(uniqued.groups.map((g) => g.name));
  const analysis = analyzeChainRules(uniqued.nodes, profile, { groupMembers });

  const chainWarnings: string[] = [];
  const chained = applyChainRules(uniqued.nodes, profile, { groupMembers });
  const validated = validateChain(chained, { groupNames, warnings: chainWarnings });
  const paths = resolveChainPaths(validated, { groupNames });

  const nodeNames = new Set(uniqued.nodes.map((n) => n.name));
  const viaStatus = (via: string): "node" | "group" | "builtin" | "missing" =>
    CHAIN_BUILTINS.has(via)
      ? "builtin"
      : groupNames.has(via)
        ? "group"
        : nodeNames.has(via)
          ? "node"
          : "missing";

  logger.debug(
    {
      profileId: id,
      ruleCount: analysis.stats.length,
      nodeCount: uniqued.nodes.length,
      conflictCount: analysis.conflicts.length,
    },
    "Chain preview",
  );

  return c.json({
    node_count: uniqued.nodes.length,
    rules: analysis.stats.map((s) => ({
      index: s.index,
      enabled: s.enabled,
      via: s.via,
      via_status: viaStatus(s.via),
      mode: s.mode,
      matched_count: s.matched.length,
      effective_count: s.effective.length,
      kept_existing_count: s.kept_existing.length,
      sample: s.matched.slice(0, MATCH_SAMPLE_LIMIT),
    })),
    unmatched_count: analysis.unmatched.length,
    conflicts: analysis.conflicts.slice(0, CONFLICT_LIMIT),
    conflict_count: analysis.conflicts.length,
    chains: paths,
    groups: uniqued.groups.map((g) => ({
      name: g.name,
      member_count: groupMembers.get(g.name)?.size ?? 0,
    })),
    nodes: uniqued.nodes.map((n) => ({
      name: n.name,
      type: n.type,
      region: n.region,
      source_provider_id: n.source_provider_id,
    })),
    warnings: [...validationWarnings, ...chainWarnings],
    revalidating: (resolved.revalidating?.length ?? 0) > 0,
  });
});

profilePreviewRouter.post("/:id/regenerate-token", async (c) => {
  const id = c.req.param("id");
  const entry = await profileRepo.get(id);
  if (!entry) return c.json({ error: "not found" }, 404);
  const { generateToken } = await import("../auth/token.js");
  const updated = { ...entry.data, token: generateToken() };
  await profileRepo.save(updated);
  logger.info({ profileId: id }, "Profile token regenerated");
  return c.json({ token: updated.token });
});
