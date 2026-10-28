import { z } from "zod";
import { cachePath } from "../storage/paths.js";
import { readJson, writeJson } from "../storage/yaml-io.js";
import { userinfoSchema, type UserInfo } from "../schemas/userinfo.js";
import { nodeSchema, type Node } from "../schemas/node.js";
import type { InfoNodeQuota } from "../parsers/info-node-extract.js";
import { resolveUserAgents } from "../schemas/provider.js";

export interface ProviderCache {
  provider_id: string;
  fetched_at: number;
  status: "ok" | "stale" | "error";
  error?: string;
  raw_userinfo_header?: string;
  userinfo?: UserInfo;
  nodes: Node[];
  // 上游配置自带的 hosts 段(Clash 顶层 hosts: / Surge [Host]),刷新时解析存这里;
  // 生成订阅时按 provider.emit_hosts 自动并入主订阅 hosts(与 nodes 一样属"上游派生缓存")。
  extracted_hosts?: Record<string, string | string[]>;
  // 从机场「信息节点」名字里提取的到期 / 流量 / 重置日(parsers/info-node-extract.ts),
  // 离线源唯一的配额信息来源;判定优先级见 providers/quota.ts。
  info_quota?: InfoNodeQuota;
  // 上次拿到节点用的 UA,下次刷新先试它(见 rememberedUserAgent)。连同当时的 UA 列表一起存:
  // 用户改了列表(换顺序 / 增删)就作废,按新顺序重新摸。
  ua_memory?: UserAgentMemory;
  // 连续失败(stale / error)的次数和最近一次尝试时间,scheduler 按它退避重试(见 load.ts retryDelayMinutes);
  // 刷新成功写 ok cache 时不带它,即清零。
  retry?: RetryState;
}

export interface RetryState {
  failures: number;
  last_attempt_at: number;
}

export interface UserAgentMemory {
  user_agent: string;
  list: string[];
}

const cacheSchema = z.object({
  provider_id: z.string(),
  fetched_at: z.number(),
  status: z.enum(["ok", "stale", "error"]),
  error: z.string().optional(),
  raw_userinfo_header: z.string().optional(),
  userinfo: userinfoSchema.optional(),
  nodes: z.array(nodeSchema).default([]),
  extracted_hosts: z.record(z.union([z.string(), z.array(z.string())])).optional(),
  info_quota: z
    .object({
      expire: z.string().optional(),
      traffic: z.object({ used: z.number().nonnegative(), total: z.number().positive() }).optional(),
      reset_at: z.number().optional(),
    })
    .optional(),
  ua_memory: z.object({ user_agent: z.string(), list: z.array(z.string()) }).optional(),
  retry: z.object({ failures: z.number().int().positive(), last_attempt_at: z.number() }).optional(),
});

/**
 * 记住的 UA 还作数时返回它:UA 列表没改过,且它还在列表里。
 * 列表里排在它前面的 UA 上次都没拿到节点,先试它省掉这些请求,也让订阅格式不在两次刷新之间来回变。
 */
export function rememberedUserAgent(
  memory: UserAgentMemory | undefined,
  userAgents: readonly string[] | undefined,
): string | undefined {
  if (!memory) return undefined;
  const list = resolveUserAgents(userAgents);
  const sameList = list.length === memory.list.length && list.every((ua, i) => ua === memory.list[i]);
  return sameList && list.includes(memory.user_agent) ? memory.user_agent : undefined;
}

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
