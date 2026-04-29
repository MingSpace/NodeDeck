import { z } from "zod";
import { cachePath } from "../storage/paths.js";
import { readJson, writeJson } from "../storage/yaml-io.js";
import { userinfoSchema, type UserInfo } from "../schemas/userinfo.js";
import { nodeSchema, type Node } from "../schemas/node.js";

export interface ProviderCache {
  provider_id: string;
  fetched_at: number;
  status: "ok" | "stale" | "error";
  error?: string;
  raw_userinfo_header?: string;
  userinfo?: UserInfo;
  nodes: Node[];
}

const cacheSchema = z.object({
  provider_id: z.string(),
  fetched_at: z.number(),
  status: z.enum(["ok", "stale", "error"]),
  error: z.string().optional(),
  raw_userinfo_header: z.string().optional(),
  userinfo: userinfoSchema.optional(),
  nodes: z.array(nodeSchema).default([]),
});

export async function readProviderCache(providerId: string): Promise<ProviderCache | null> {
  const data = await readJson<unknown>(cachePath(providerId));
  if (!data) return null;
  const parsed = cacheSchema.safeParse(data);
  return parsed.success ? parsed.data : null;
}

export async function writeProviderCache(cache: ProviderCache): Promise<void> {
  const validated = cacheSchema.parse(cache);
  await writeJson(cachePath(cache.provider_id), validated);
}
