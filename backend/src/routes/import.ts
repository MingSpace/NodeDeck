import { Hono } from "hono";
import { importSurgeConf } from "../import/surge.js";
import { importClashYaml } from "../import/clash.js";
import {
  rulesetRepo,
  proxyGroupRepo,
  generalPresetRepo,
  surgeModuleRepo,
} from "../storage/repos.js";
import { readManualNodes, writeManualNodes } from "../storage/manual-nodes.js";

export const importRouter = new Hono();

importRouter.post("/preview", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.text !== "string") {
    return c.json({ error: "expected { text, kind? }" }, 400);
  }
  const text = body.text as string;
  const kind = (body.kind as string) ?? autoDetectKind(text);
  if (kind === "surge") {
    const result = importSurgeConf(text);
    return c.json({ kind, ...redact(result) });
  }
  if (kind === "clash") {
    const result = importClashYaml(text);
    return c.json({ kind, ...redact(result) });
  }
  return c.json({ error: "unable to detect format; specify kind=clash|surge" }, 400);
});

importRouter.post("/commit", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid body" }, 400);
  const text = body.text as string;
  const kind = (body.kind as string) ?? autoDetectKind(text);
  const opts = body.options ?? { import_general: true, import_nodes: true, import_rules: true, import_groups: true, import_modules: true };

  let result: ReturnType<typeof importSurgeConf> | ReturnType<typeof importClashYaml>;
  if (kind === "surge") result = importSurgeConf(text);
  else if (kind === "clash") result = importClashYaml(text);
  else return c.json({ error: "unable to detect format" }, 400);

  const stats = { general: 0, manual_nodes: 0, rules: 0, groups: 0, modules: 0, providers: 0 };

  if (opts.import_general && result.general) {
    await generalPresetRepo.save(result.general);
    stats.general = 1;
  }
  if (opts.import_nodes && result.manualNodes.length > 0) {
    const existing = await readManualNodes();
    const merged = [...existing.nodes, ...result.manualNodes];
    await writeManualNodes({ nodes: merged });
    stats.manual_nodes = result.manualNodes.length;
  }
  if (opts.import_rules) {
    for (const r of result.ruleSets) {
      await rulesetRepo.save(r);
      stats.rules++;
    }
  }
  if (opts.import_groups) {
    for (const g of result.proxyGroups) {
      await proxyGroupRepo.save(g);
      stats.groups++;
    }
  }
  if (kind === "surge" && opts.import_modules) {
    const surgeRes = result as ReturnType<typeof importSurgeConf>;
    for (const m of surgeRes.modules) {
      await surgeModuleRepo.save(m);
      stats.modules++;
    }
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
