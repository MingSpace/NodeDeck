import { Hono } from "hono";
import { z } from "zod";
import { providerRepo } from "../storage/repos.js";
import { refreshProvider, refreshAllProviders } from "../providers/load.js";
import { readProviderCache } from "../providers/cache-store.js";
import { listProvidersWithCache } from "../providers/pool.js";
import { fetchProviderContent } from "../providers/fetcher.js";
import { redactProxyUrl } from "../providers/fetch-proxy.js";
import { parseSubscriptionWithInfo } from "../parsers/index.js";
import { fetchProxySchema, parserHintSchema } from "../schemas/provider.js";
import { logger } from "../logger.js";

export const providerActionsRouter = new Hono();

providerActionsRouter.get("/status", async (c) => {
  const summaries = await listProvidersWithCache();
  return c.json({ items: summaries });
});

providerActionsRouter.get("/:id/nodes", async (c) => {
  const id = c.req.param("id");
  const cache = await readProviderCache(id);
  if (!cache) return c.json({ error: "no cache yet" }, 404);
  return c.json({
    provider_id: id,
    count: cache.nodes.length,
    fetched_at: cache.fetched_at,
    nodes: cache.nodes,
  });
});

providerActionsRouter.post("/:id/refresh", async (c) => {
  const id = c.req.param("id");
  const entry = await providerRepo.get(id);
  if (!entry) return c.json({ error: "provider not found" }, 404);
  logger.info({ providerId: id, source: "manual" }, "Provider refresh requested");
  const cache = await refreshProvider(entry.data, { force: true });
  return c.json({
    provider_id: cache.provider_id,
    status: cache.status,
    fetched_at: cache.fetched_at,
    node_count: cache.nodes.length,
    error: cache.error,
  });
});

// 该节点源上游自带、刷新时自动解析到的 hosts(Clash 顶层 hosts: / Surge [Host])。
// 供编辑页只读预览;emit_hosts 开启时这些会自动并入生成的订阅(profile-resolver)。
providerActionsRouter.get("/:id/extracted-hosts", async (c) => {
  const id = c.req.param("id");
  const cache = await readProviderCache(id);
  const hosts = cache?.extracted_hosts ?? {};
  return c.json({
    provider_id: id,
    count: Object.keys(hosts).length,
    fetched_at: cache?.fetched_at,
    hosts,
  });
});

providerActionsRouter.post("/refresh-all", async (c) => {
  logger.info({ source: "manual" }, "Provider refresh-all requested");
  const result = await refreshAllProviders({ force: true });
  logger.info(
    { refreshed: result.refreshed.length, skipped: result.skippedLocked.length },
    "Provider refresh-all done",
  );
  return c.json({
    count: result.refreshed.length,
    skipped_locked: result.skippedLocked,
  });
});

// 编辑页「测试拉取」:用表单里还没保存的 url / UA / 代理试拉一次,只解析不写 cache。
// 配了代理时同时测直连,一眼看出「直连 403、经代理 200」这类按来源 IP 拦截。
const testFetchSchema = z.object({
  url: z.string().trim().url("订阅 URL 格式不对"),
  user_agent: z.string().default(""),
  fetch_proxy: fetchProxySchema,
  parser_hint: parserHintSchema.default("auto"),
});

// 与 frontend/src/pages/providers/fetch-proxy.tsx TestFetchAttempt 保持同步
interface TestFetchAttempt {
  route: "direct" | "proxy";
  ok: boolean;
  error?: string;
  node_count: number;
  bytes: number;
  has_userinfo: boolean;
  used_user_agent?: string;
  duration_ms: number;
}

const TEST_FETCH_TIMEOUT_MS = 15_000;

async function testFetchRoute(
  input: z.infer<typeof testFetchSchema>,
  route: TestFetchAttempt["route"],
): Promise<TestFetchAttempt> {
  const started = Date.now();
  try {
    const result = await fetchProviderContent(
      {
        id: "test-fetch",
        type: "http",
        url: input.url,
        user_agent: input.user_agent,
        fetch_proxy: route === "proxy" ? input.fetch_proxy : undefined,
      },
      { timeoutMs: TEST_FETCH_TIMEOUT_MS },
    );
    const { nodes } = parseSubscriptionWithInfo(result.text, input.parser_hint);
    return {
      route,
      ok: nodes.length > 0,
      error:
        nodes.length > 0
          ? undefined
          : result.text.trim()
            ? "拿到了内容,但没解析出节点"
            : "上游返回空内容",
      node_count: nodes.length,
      bytes: Buffer.byteLength(result.text),
      has_userinfo: !!result.userinfo_header,
      used_user_agent: result.used_user_agent,
      duration_ms: Date.now() - started,
    };
  } catch (err) {
    return {
      route,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      node_count: 0,
      bytes: 0,
      has_userinfo: false,
      duration_ms: Date.now() - started,
    };
  }
}

providerActionsRouter.post("/test-fetch", async (c) => {
  const parsed = testFetchSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "validation failed" }, 400);
  }
  const input = parsed.data;
  logger.info(
    { proxy: input.fetch_proxy ? redactProxyUrl(input.fetch_proxy) : undefined },
    "Provider test fetch requested",
  );
  const routes: TestFetchAttempt["route"][] = input.fetch_proxy ? ["proxy", "direct"] : ["direct"];
  const attempts = await Promise.all(routes.map((route) => testFetchRoute(input, route)));
  return c.json({ attempts });
});
