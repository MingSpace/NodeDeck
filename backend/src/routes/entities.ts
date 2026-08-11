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
import { providerSchema, type Provider } from "../schemas/provider.js";
import { rulesetSchema } from "../schemas/ruleset.js";
import { proxyGroupSchema } from "../schemas/proxy-group.js";
import { generalPresetSchema } from "../schemas/general-preset.js";
import { surgeModuleSchema } from "../schemas/surge-module.js";
import { profileSchema } from "../schemas/profile.js";
import { refreshProvider } from "../providers/load.js";
import {
  findEntityReferences,
  isReferenceableKind,
  describeReferences,
  type EntityReference,
} from "../refs/entity-references.js";
import { logger } from "../logger.js";

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

// meta 与 items 分开返回,而不是把 updated_at 混进实体对象:实体对象会被前端原样
// PUT 回来、也会在 YAML 编辑弹窗里直接展示,混入非 schema 字段会污染用户看到的 yaml。
// 时间来源是文件 mtime —— schema 里不存时间戳,文件本身就是唯一真相。
entitiesRouter.get("/:kind", async (c) => {
  const def = KINDS[c.req.param("kind")];
  if (!def) return c.json({ error: "unknown entity kind" }, 404);
  const list = await def.repo.list();
  return c.json({
    items: list.map((e) => e.data),
    meta: Object.fromEntries(list.map((e) => [e.id, { updated_at: Math.round(e.mtimeMs) }])),
  });
});

entitiesRouter.get("/:kind/:id", async (c) => {
  const def = KINDS[c.req.param("kind")];
  if (!def) return c.json({ error: "unknown entity kind" }, 404);
  const entry = await def.repo.get(c.req.param("id"));
  if (!entry) return c.json({ error: "not found" }, 404);
  return c.json(entry.data);
});

// 谁在引用我。前端删除前先查这里,以便在确认弹窗里直接列出引用位置,
// 而不是等 DELETE 吃一个 409。
entitiesRouter.get("/:kind/:id/references", async (c) => {
  const kind = c.req.param("kind");
  if (!KINDS[kind]) return c.json({ error: "unknown entity kind" }, 404);
  if (!isReferenceableKind(kind)) return c.json({ references: [] });
  const references = await findEntityReferences(kind, c.req.param("id"));
  return c.json({ references });
});

// 保存 provider 时按需异步重拉一次:
// - 新建任意类型 + enabled=true → 拉一次种子,用户填完几秒内能看到节点
// - 编辑 inline + enabled=true → 重新解析 content(inline 无"上游"概念,UI 不暴露刷新按钮,
//   保存即生效;refresh 成本=fs.read+parseSubscription,极低)
// - 编辑 http/file → 不动 cache,由用户手动点刷新或等 cron(避免每次保存都打机场)
// - enabled=false(草稿)一律跳过
// 失败仅记日志;refreshProvider 自身会写 error cache,前端 status 轮询会反映出来。
function maybeAutoRefreshProvider(kind: string, isNew: boolean, data: unknown): void {
  if (kind !== "providers") return;
  const provider = data as Provider;
  if (!provider.enabled) return;
  if (!isNew && provider.type !== "inline") return;
  void refreshProvider(provider, { force: true }).catch((err) => {
    logger.warn(
      { err, providerId: provider.id, isNew, type: provider.type },
      "auto-refresh on provider save failed",
    );
  });
}

entitiesRouter.put("/:kind/:id", async (c) => {
  const kind = c.req.param("kind");
  const def = KINDS[kind];
  if (!def) return c.json({ error: "unknown entity kind" }, 404);
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid json" }, 400);
  // id 是文件主键,被 Profile 等其它实体按 id 引用。PUT 只允许写回同一 id;
  // 如果 body 自带 id 但与 url 不一致,直接拒绝以避免出现:写出新文件、留下旧文件、
  // 其它实体里的引用变成悬空。要"重命名"请改 name 字段;要"复制"请用 POST。
  if (
    typeof body === "object" &&
    body !== null &&
    "id" in body &&
    typeof (body as { id?: unknown }).id === "string" &&
    (body as { id: string }).id !== id
  ) {
    return c.json(
      {
        error: "id mismatch",
        message:
          "URL 路径中的 id 与请求体 id 不一致。id 是文件主键,不可在编辑流程中修改。请改用 POST /api/entities/:kind 创建新条目,或修改 name 字段。",
      },
      400,
    );
  }
  const result = def.schema.safeParse({ ...body, id });
  if (!result.success) {
    return c.json({ error: "validation failed", details: result.error.flatten() }, 400);
  }
  // PUT 是 upsert,前端"新建/编辑"都走这条路径;先看文件是否存在以区分两种语义。
  const existed = await def.repo.exists(id);
  const saved = await def.repo.save(result.data);
  logger.info(
    { kind, id: saved.data.id, op: existed ? "update" : "create" },
    "Entity saved",
  );
  maybeAutoRefreshProvider(kind, !existed, saved.data);
  return c.json(saved.data);
});

entitiesRouter.post("/:kind", async (c) => {
  const kind = c.req.param("kind");
  const def = KINDS[kind];
  if (!def) return c.json({ error: "unknown entity kind" }, 404);
  const body = await c.req.json().catch(() => null);
  if (!body) return c.json({ error: "invalid json" }, 400);
  const result = def.schema.safeParse(body);
  if (!result.success) {
    return c.json({ error: "validation failed", details: result.error.flatten() }, 400);
  }
  const saved = await def.repo.save(result.data);
  logger.info({ kind, id: saved.data.id, op: "create" }, "Entity saved");
  maybeAutoRefreshProvider(kind, true, saved.data);
  return c.json(saved.data, 201);
});

entitiesRouter.delete("/:kind/:id", async (c) => {
  const kind = c.req.param("kind");
  const def = KINDS[kind];
  if (!def) return c.json({ error: "unknown entity kind" }, 404);
  const id = c.req.param("id");
  // 删掉一个还被引用的实体 = 给用户留一堆悬空引用(客户端报 policy not found /
  // 组里凭空少节点),而 yaml 里没有回滚。所以引用检查在这里硬拦,
  // 用户必须先去引用方解开引用。
  if (isReferenceableKind(kind)) {
    const references = await findEntityReferences(kind, id);
    const blocking = references.filter((r) => r.blocking);
    if (blocking.length > 0) {
      logger.info({ kind, id, references: blocking.length }, "Entity delete blocked by references");
      return c.json(
        {
          error: "entity is referenced",
          message: `无法删除:仍被 ${describeReferences(blocking)} 引用,请先解除引用。`,
          references,
        },
        409,
      );
    }
    logNonBlockingReferences(kind, id, references);
  }
  await def.repo.delete(id);
  logger.info({ kind, id }, "Entity deleted");
  return c.json({ ok: true });
});

function logNonBlockingReferences(kind: string, id: string, references: EntityReference[]): void {
  const soft = references.filter((r) => !r.blocking);
  if (soft.length === 0) return;
  logger.warn(
    { kind, id, references: soft.map((r) => `${r.from_kind}/${r.from_id}:${r.field}`) },
    "Deleted entity was softly referenced",
  );
}

