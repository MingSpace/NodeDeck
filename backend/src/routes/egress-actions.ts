import { Hono } from "hono";
import { egressSchema } from "../schemas/egress.js";
import { authorizedKeysLine, getEgressKeyPair } from "../providers/egress-key.js";
import { openEgressFetch } from "../providers/egress.js";
import { describeFetchError } from "../providers/fetch-proxy.js";
import { logger } from "../logger.js";

export const egressActionsRouter = new Hono();

// 出口页展示 NodeDeck 的 SSH 公钥,用户贴进出口机 authorized_keys
egressActionsRouter.get("/public-key", (c) => {
  const { publicKey } = getEgressKeyPair();
  return c.json({ public_key: publicKey, authorized_keys_line: authorizedKeysLine(publicKey) });
});

// 「测试连接」探测地址:Cloudflare 的 trace 端点返回请求方 IP 与国家,正好用来确认出口落地在哪。
export const EGRESS_PROBE_URL = "https://www.cloudflare.com/cdn-cgi/trace";
const TEST_TIMEOUT_MS = 15_000;

// 与 frontend/src/pages/egresses/visual-form.tsx EgressTestResult 保持同步
interface EgressTestResult {
  ok: boolean;
  error?: string;
  /** 经该出口访问外网时对方看到的 IP / 国家代码 */
  ip?: string;
  loc?: string;
  /** SSH 出口握手时拿到的主机指纹 */
  host_key?: string;
  duration_ms: number;
}

// 用表单里还没保存的出口配置试连一次,不落盘
egressActionsRouter.post("/test", async (c) => {
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  // 新建时表单可能还没定 id,给个占位让 schema 过
  const parsed = egressSchema.safeParse({ id: "egress-test", ...body });
  if (!parsed.success) {
    return c.json({ error: parsed.error.issues[0]?.message ?? "validation failed" }, 400);
  }
  const egress = parsed.data;
  const started = Date.now();
  const result: EgressTestResult = { ok: false, duration_ms: 0 };
  const routed = openEgressFetch(egress, { onHostKey: (fp) => (result.host_key = fp) });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    const res = await routed.fetch(EGRESS_PROBE_URL, { signal: controller.signal });
    const text = await res.text();
    const fields = Object.fromEntries(
      text.split("\n").map((line) => line.split("=", 2) as [string, string]).filter(([, v]) => v !== undefined),
    );
    result.ok = res.ok;
    result.ip = fields.ip;
    result.loc = fields.loc;
    if (!res.ok) result.error = `探测地址返回 HTTP ${res.status}`;
  } catch (err) {
    result.error = describeFetchError(err).replace(/^fetch failed: /, "");
  } finally {
    clearTimeout(timeout);
    await routed.close().catch(() => undefined);
  }
  result.duration_ms = Date.now() - started;
  logger.info({ egress: egress.name, type: egress.type, ok: result.ok, loc: result.loc }, "Egress test");
  return c.json(result);
});
