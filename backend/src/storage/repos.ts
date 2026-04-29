import { Repo } from "./repo.js";
import { providerSchema } from "../schemas/provider.js";
import { rulesetSchema } from "../schemas/ruleset.js";
import { proxyGroupSchema } from "../schemas/proxy-group.js";
import { generalPresetSchema } from "../schemas/general-preset.js";
import { surgeModuleSchema } from "../schemas/surge-module.js";
import { profileSchema } from "../schemas/profile.js";

export const providerRepo = new Repo({ sub: "providers", schema: providerSchema });
export const rulesetRepo = new Repo({ sub: "rules", schema: rulesetSchema });
export const proxyGroupRepo = new Repo({ sub: "groups", schema: proxyGroupSchema });
export const generalPresetRepo = new Repo({ sub: "general", schema: generalPresetSchema });
export const surgeModuleRepo = new Repo({ sub: "modules", schema: surgeModuleSchema });
export const profileRepo = new Repo({ sub: "profiles", schema: profileSchema });
