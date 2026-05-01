import { Hono } from "hono";
import { z } from "zod";
import { profileRepo } from "../storage/repos.js";
import { resolveProfile } from "../generators/profile-resolver.js";
import { generateClashConfig } from "../generators/clash.js";
import { generateSurgeConfig } from "../generators/surge.js";
import { env } from "../env.js";
import { loadConfig } from "../storage/config-store.js";
import { buildNodePool } from "../providers/pool.js";
import { applyNodeFilter } from "../generators/node-filter.js";
import { nodeFilterSchema } from "../schemas/profile.js";

export const profilePreviewRouter = new Hono();

const nodePoolPreviewSchema = z.object({
  providers: z.array(z.string()).default([]),
  include_manual_nodes: z.boolean().default(true),
  node_filter: nodeFilterSchema.optional(),
});

profilePreviewRouter.get("/:id/preview", async (c) => {
  const id = c.req.param("id");
  const target = c.req.query("target") ?? "clash";
  if (target !== "clash" && target !== "surge") {
    return c.json({ error: "target must be clash or surge" }, 400);
  }
  const entry = await profileRepo.get(id);
  if (!entry) return c.json({ error: "not found" }, 404);
  const profile = entry.data;
  const resolved = await resolveProfile(profile);
  if (target === "clash") {
    const text = generateClashConfig({
      profile,
      nodes: resolved.nodes,
      groups: resolved.groups,
      rules: resolved.rules,
      finalRule: resolved.finalRule,
      geoipFallback: resolved.geoipFallback,
      general: resolved.general,
      warnings: resolved.warnings,
    });
    return c.json({ target, text, warnings: resolved.warnings, node_count: resolved.nodes.length });
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
    groups: resolved.groups,
    rules: resolved.rules,
    finalRule: resolved.finalRule,
    geoipFallback: resolved.geoipFallback,
    general: resolved.general,
    surgeModules: resolved.surgeModules,
    managed_config_url: managedConfigUrl,
    warnings: resolved.warnings,
  });
  return c.json({ target, text, warnings: resolved.warnings, node_count: resolved.nodes.length });
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
  const pool = await buildNodePool({
    providerIds: parsed.data.providers,
    includeManual: parsed.data.include_manual_nodes,
  });
  const filter = parsed.data.node_filter ?? {
    rename_rules: [],
    exclude_types: [],
  };
  const filtered = applyNodeFilter(pool.nodes, filter);
  const byProvider: Record<string, number> = {};
  for (const [provId, nodes] of pool.byProvider) {
    byProvider[provId] = nodes.length;
  }
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
  });
});

profilePreviewRouter.post("/:id/regenerate-token", async (c) => {
  const id = c.req.param("id");
  const entry = await profileRepo.get(id);
  if (!entry) return c.json({ error: "not found" }, 404);
  const { generateToken } = await import("../auth/token.js");
  const updated = { ...entry.data, token: generateToken() };
  await profileRepo.save(updated);
  return c.json({ token: updated.token });
});
