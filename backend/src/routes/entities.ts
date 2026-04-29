import { Hono } from "hono";
import type { ZodTypeAny } from "zod";
import {
  providerRepo,
  rulesetRepo,
  proxyGroupRepo,
  generalPresetRepo,
  surgeModuleRepo,
  profileRepo,
} from "../storage/repos.js";
import { Repo } from "../storage/repo.js";
import { providerSchema } from "../schemas/provider.js";
import { rulesetSchema } from "../schemas/ruleset.js";
import { proxyGroupSchema } from "../schemas/proxy-group.js";
import { generalPresetSchema } from "../schemas/general-preset.js";
import { surgeModuleSchema } from "../schemas/surge-module.js";
import { profileSchema } from "../schemas/profile.js";
import { readManualNodes, writeManualNodes } from "../storage/manual-nodes.js";
import { manualNodesSchema } from "../schemas/node.js";

interface EntityKindDef {
  repo: Repo<ZodTypeAny, { id: string } & Record<string, unknown>>;
  schema: ZodTypeAny;
}

const KINDS: Record<string, EntityKindDef> = {
  providers: { repo: providerRepo as Repo<ZodTypeAny, { id: string } & Record<string, unknown>>, schema: providerSchema },
  rules: { repo: rulesetRepo as Repo<ZodTypeAny, { id: string } & Record<string, unknown>>, schema: rulesetSchema },
  groups: { repo: proxyGroupRepo as Repo<ZodTypeAny, { id: string } & Record<string, unknown>>, schema: proxyGroupSchema },
  generals: { repo: generalPresetRepo as Repo<ZodTypeAny, { id: string } & Record<string, unknown>>, schema: generalPresetSchema },
  modules: { repo: surgeModuleRepo as Repo<ZodTypeAny, { id: string } & Record<string, unknown>>, schema: surgeModuleSchema },
  profiles: { repo: profileRepo as Repo<ZodTypeAny, { id: string } & Record<string, unknown>>, schema: profileSchema },
};

export const entitiesRouter = new Hono();

entitiesRouter.get("/:kind", async (c) => {
  const def = KINDS[c.req.param("kind")];
  if (!def) return c.json({ error: "unknown entity kind" }, 404);
  const list = await def.repo.list();
  return c.json({ items: list.map((e) => e.data) });
});

entitiesRouter.get("/:kind/:id", async (c) => {
  const def = KINDS[c.req.param("kind")];
  if (!def) return c.json({ error: "unknown entity kind" }, 404);
  const entry = await def.repo.get(c.req.param("id"));
  if (!entry) return c.json({ error: "not found" }, 404);
  return c.json(entry.data);
});

entitiesRouter.put("/:kind/:id", async (c) => {
  const def = KINDS[c.req.param("kind")];
  if (!def) return c.json({ error: "unknown entity kind" }, 404);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid json" }, 400);
  const result = def.schema.safeParse({ ...body, id });
  if (!result.success) {
    return c.json({ error: "validation failed", details: result.error.flatten() }, 400);
  }
  const saved = await def.repo.save(result.data);
  return c.json(saved.data);
});

entitiesRouter.post("/:kind", async (c) => {
  const def = KINDS[c.req.param("kind")];
  if (!def) return c.json({ error: "unknown entity kind" }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid json" }, 400);
  const result = def.schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: "validation failed", details: result.error.flatten() }, 400);
  }
  const saved = await def.repo.save(result.data);
  return c.json(saved.data, 201);
});

entitiesRouter.delete("/:kind/:id", async (c) => {
  const def = KINDS[c.req.param("kind")];
  if (!def) return c.json({ error: "unknown entity kind" }, 404);
  await def.repo.delete(c.req.param("id"));
  return c.json({ ok: true });
});

// Manual nodes (singleton, not part of repo grid)
entitiesRouter.get("/manual-nodes", async (c) => {
  const data = await readManualNodes();
  return c.json(data);
});

entitiesRouter.put("/manual-nodes", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid json" }, 400);
  const result = manualNodesSchema.safeParse(body);
  if (!result.success) {
    return c.json({ error: "validation failed", details: result.error.flatten() }, 400);
  }
  await writeManualNodes(result.data);
  return c.json(result.data);
});
