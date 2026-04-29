import { Hono } from "hono";
import { profileRepo } from "../storage/repos.js";
import { resolveProfile } from "../generators/profile-resolver.js";
import { generateClashConfig } from "../generators/clash.js";
import { generateSurgeConfig } from "../generators/surge.js";
import { env } from "../env.js";
import { loadConfig } from "../storage/config-store.js";

export const profilePreviewRouter = new Hono();

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

profilePreviewRouter.post("/:id/regenerate-token", async (c) => {
  const id = c.req.param("id");
  const entry = await profileRepo.get(id);
  if (!entry) return c.json({ error: "not found" }, 404);
  const { generateToken } = await import("../auth/token.js");
  const updated = { ...entry.data, token: generateToken() };
  await profileRepo.save(updated);
  return c.json({ token: updated.token });
});
