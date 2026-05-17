import type { Hono } from "hono";
import { profileRepo, providerRepo } from "../storage/repos.js";
import { resolveProfile } from "../generators/profile-resolver.js";
import { generateClashConfig, generateProxyProviderYaml } from "../generators/clash.js";
import { generateSurgeConfig } from "../generators/surge.js";
import { aggregateUserInfo } from "../userinfo/aggregate.js";
import { applyNodeFilter } from "../generators/node-filter.js";
import { env } from "../env.js";
import { loadConfig } from "../storage/config-store.js";
import { loadProviderNodes } from "../providers/load.js";
import { refreshIntervalToSeconds } from "../schemas/common.js";

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
  // mihomo proxy-providers 拉取目标:把单个机场的节点切片输出为仅含 proxies: 段的 yaml。
  // 校验通过 profile token 实现:必须带 ?profile=<pid>&t=<token>,且 provider 在该 profile 中。
  app.get("/sub/provider/:id/clash.yaml", async (c) => handleProviderClashYaml(c));
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

  // userinfo: 完全可选;关闭时不读 cache 也不写任何相关响应头
  if (profile.userinfo.enabled) {
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
  }

  // mihomo / Surge 都支持 Profile-Update-Interval 单位 = 小时;
  // 之前只有 clash 分支 hard-code 24,这里统一从 profile.managed_config_interval(秒)派生。
  const intervalHours = String(Math.max(1, Math.round(profile.managed_config_interval / 3600)));

  if (args.target === "clash") {
    const text = generateClashConfig({
      profile,
      nodes: resolved.nodes,
      providers: resolved.providers,
      baseUrl,
      profileToken: profile.token,
      groups: resolved.groups,
      allKnownGroupNames: resolved.allKnownGroupNames,
      rules: resolved.rules,
      finalRule: resolved.finalRule,
      geoipFallback: resolved.geoipFallback,
      general: resolved.general,
      warnings: resolved.warnings,
    });
    c.header("Content-Type", "text/yaml; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="${profile.id}.yaml"`);
    c.header("Profile-Update-Interval", intervalHours);
    return c.body(text);
  } else {
    const text = generateSurgeConfig({
      profile,
      nodes: resolved.nodes,
      groups: resolved.groups,
      allKnownGroupNames: resolved.allKnownGroupNames,
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
    c.header("Profile-Update-Interval", intervalHours);
    return c.body(text);
  }
}

async function handleProviderClashYaml(c: import("hono").Context) {
  const providerId = c.req.param("id");
  const profileId = c.req.query("profile") ?? "";
  const t = c.req.query("t") ?? "";
  if (!providerId || !profileId || !t) {
    return c.text("missing query parameters: profile, t", 400);
  }
  const profileEntry = await profileRepo.get(profileId);
  if (!profileEntry) return c.text("profile not found", 404);
  const profile = profileEntry.data;
  if (profile.token !== t) return c.text("invalid token", 401);
  if (!profile.providers.includes(providerId)) {
    return c.text("provider not part of this profile", 404);
  }
  const providerEntry = await providerRepo.get(providerId);
  if (!providerEntry) return c.text("provider not found", 404);
  const provider = providerEntry.data;
  if (!provider.enabled) return c.text("provider disabled", 404);
  if (!provider.clash_proxy_provider.enabled) {
    return c.text("provider has clash_proxy_provider disabled", 404);
  }

  // 仅取该 provider 的节点(不混入其他机场,也不混入手动节点),
  // 但仍走该 profile 的 node_filter 让用户能过滤/重命名。
  const allNodes = await loadProviderNodes(provider);
  const filtered = applyNodeFilter(allNodes, profile.node_filter);
  const warnings: string[] = [];
  const text = generateProxyProviderYaml(filtered, warnings);

  c.header("Content-Type", "text/yaml; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${providerId}.yaml"`);
  c.header(
    "Profile-Update-Interval",
    String(Math.max(1, Math.round(refreshIntervalToSeconds(provider.refresh.interval) / 3600))),
  );
  return c.body(text);
}

function formatUserInfo(info: { upload: number; download: number; total: number; expire: number }): string {
  const parts: string[] = [];
  parts.push(`upload=${info.upload}`);
  parts.push(`download=${info.download}`);
  if (info.total) parts.push(`total=${info.total}`);
  if (info.expire) parts.push(`expire=${info.expire}`);
  return parts.join("; ");
}
