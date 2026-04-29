import type { Profile } from "../schemas/profile.js";
import type { UserInfo } from "../schemas/userinfo.js";
import { providerRepo } from "../storage/repos.js";
import { readProviderCache } from "../providers/cache-store.js";

export interface PerProviderInfo {
  provider_id: string;
  provider_name: string;
  raw_header?: string;
  userinfo?: UserInfo;
}

export interface AggregatedUserInfo {
  aggregated: UserInfo | null;
  perProvider: PerProviderInfo[];
}

export async function aggregateUserInfo(profile: Profile): Promise<AggregatedUserInfo> {
  const ids = profile.providers;
  const perProvider: PerProviderInfo[] = [];
  for (const id of ids) {
    const entry = await providerRepo.get(id);
    if (!entry) continue;
    const cache = await readProviderCache(id);
    perProvider.push({
      provider_id: id,
      provider_name: entry.data.name,
      raw_header: cache?.raw_userinfo_header,
      userinfo: cache?.userinfo,
    });
  }

  let aggregated: UserInfo | null = null;
  if (profile.userinfo.mode === "primary") {
    const target = profile.userinfo.primary_provider;
    const found = perProvider.find((p) => p.provider_id === target);
    aggregated = found?.userinfo ?? null;
  } else {
    // sum
    let upload = 0;
    let download = 0;
    let total = 0;
    let expire = 0;
    let hasAny = false;
    for (const p of perProvider) {
      if (!p.userinfo) continue;
      hasAny = true;
      upload += p.userinfo.upload;
      download += p.userinfo.download;
      total += p.userinfo.total;
      if (p.userinfo.expire > 0) {
        expire = expire === 0 ? p.userinfo.expire : Math.min(expire, p.userinfo.expire);
      }
    }
    if (hasAny) aggregated = { upload, download, total, expire };
  }

  return { aggregated, perProvider };
}
