import type { Hono } from "hono";
import { profileRepo } from "../storage/repos.js";
import { resolveProfile } from "../generators/profile-resolver.js";
import { generateClashConfig } from "../generators/clash.js";
import { generateSurgeConfig } from "../generators/surge.js";
import { aggregateUserInfo } from "../userinfo/aggregate.js";
import { env } from "../env.js";
import { loadConfig } from "../storage/config-store.js";

export function mountSubRoute(app: Hono): void {
  app.get("/sub", async (c) => handleSub(c));
  app.get("/sub/clash/:profile", async (c) => {
    const profile = c.req.param("profile");
    const t = c.req.query("t") ?? "";
    return handleSubInner(c, { profile, target: "clash", t });
  });
  app.get("/sub/surge/:profile", async (c) => {
    const profile = c.req.param("profile");
    const t = c.req.query("t") ?? "";
    return handleSubInner(c, { profile, target: "surge", t });
  });
}

async function handleSub(c: import("hono").Context) {
  const profileId = c.req.query("profile") ?? "";
  const target = c.req.query("target") ?? "";
  const t = c.req.query("t") ?? "";
  return handleSubInner(c, { profile: profileId, target, t });
}

async function handleSubInner(
  c: import("hono").Context,
  args: { profile: string; target: string; t: string },
) {
  if (!args.profile || !args.target || !args.t) {
    return c.text("missing query parameters: profile, target, t", 400);
  }
  if (args.target !== "clash" && args.target !== "surge") {
    return c.text("target must be 'clash' or 'surge'", 400);
  }
  const entry = await profileRepo.get(args.profile);
  if (!entry) return c.text("profile not found", 404);
  const profile = entry.data;
  if (profile.token !== args.t) return c.text("invalid token", 401);

  const resolved = await resolveProfile(profile);

  // Build managed-config URL (Surge only)
  const cfg = await loadConfig();
  const baseUrl = cfg.public_base_url ?? env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
  let managedConfigUrl: string | undefined;
  if (profile.managed_config_url === "auto") {
    managedConfigUrl = `${baseUrl}/sub?profile=${profile.id}&target=surge&t=${profile.token}`;
  } else if (profile.managed_config_url !== "none") {
    managedConfigUrl = profile.managed_config_url;
  }

  // userinfo
  const userinfoResult = await aggregateUserInfo(profile);
  if (userinfoResult.aggregated) {
    const headerVal = formatUserInfo(userinfoResult.aggregated);
    if (headerVal) c.header("Subscription-UserInfo", headerVal);
  }
  if (profile.userinfo.expose_per_provider_headers) {
    for (const item of userinfoResult.perProvider) {
      if (item.raw_header) {
        c.header(`X-MConvert-Userinfo-${item.provider_id}`, item.raw_header);
      }
    }
  }

  if (args.target === "clash") {
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
    c.header("Content-Type", "text/yaml; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${profile.id}.yaml"`);
    c.header("Profile-Update-Interval", "24");
    return c.body(text);
  } else {
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
    c.header("Content-Type", "text/plain; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${profile.id}.conf"`);
    return c.body(text);
  }
}

function formatUserInfo(info: { upload: number; download: number; total: number; expire: number }): string {
  const parts: string[] = [];
  parts.push(`upload=${info.upload}`);
  parts.push(`download=${info.download}`);
  if (info.total) parts.push(`total=${info.total}`);
  if (info.expire) parts.push(`expire=${info.expire}`);
  return parts.join("; ");
}
