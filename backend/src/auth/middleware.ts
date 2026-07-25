import type { Context, MiddlewareHandler } from "hono";
import { verifySessionCookie } from "./session.js";
import { loadConfig } from "../storage/config-store.js";
import { logger } from "../logger.js";

declare module "hono" {
  interface ContextVariableMap {
    user?: { username: string; must_change_password: boolean };
  }
}

/** 从请求里提取客户端 IP。优先 X-Forwarded-For 链首,其次 X-Real-IP,都没有就 "unknown"。 */
export function getClientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
    c.req.header("x-real-ip") ??
    "unknown"
  );
}

export const requireSession: MiddlewareHandler = async (c, next) => {
  const cookie = c.req.header("cookie");
  const session = verifySessionCookie(cookie);
  if (!session) {
    return c.json({ error: "unauthorized" }, 401);
  }
  const cfg = await loadConfig();
  if (cfg.admin.username !== session.username) {
    return c.json({ error: "unauthorized" }, 401);
  }
  c.set("user", { username: session.username, must_change_password: cfg.admin.must_change_password });
  await next();
};

export const ipAllowlist: MiddlewareHandler = async (c, next) => {
  const cfg = await loadConfig();
  const list = cfg.ip_allowlist;
  if (list.length === 0) return next();
  const ip = getClientIp(c);
  if (!list.some((entry) => matchIp(entry, ip))) {
    logger.warn({ ip, path: c.req.path }, "Blocked by IP allowlist");
    return c.json({ error: "forbidden" }, 403);
  }
  await next();
};

/**
 * 白名单条目是否可能匹配到任何客户端 IP。
 *
 * @business_rule 写不进去比写错更安全:一条永远匹配不上的规则(如 `1.2.3` / `10.0.0.0/33`)
 * 会把管理员锁在 /api/config 外面,只能 SSH 改 config.yaml 才能恢复,所以保存时就要拦。
 * 支持范围与 `matchIp` 对齐:IPv4 精确、IPv4 CIDR,以及 IPv6 字面量(仅精确匹配)。
 */
export function isValidAllowlistEntry(entry: string): boolean {
  if (entry.includes(":")) return /^[0-9a-fA-F:]+$/.test(entry);
  const parts = entry.split("/");
  if (parts.length > 2) return false;
  if (ipv4ToNum(parts[0]) === null) return false;
  if (parts.length === 1) return true;
  const bits = Number(parts[1]);
  return Number.isInteger(bits) && bits >= 0 && bits <= 32;
}

function matchIp(rule: string, ip: string): boolean {
  if (rule === ip) return true;
  if (rule.endsWith("/0")) return true;
  if (rule.includes("/")) {
    // Naive CIDR check for IPv4
    return cidrContainsV4(rule, ip);
  }
  return false;
}

function cidrContainsV4(cidr: string, ip: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;
  const baseNum = ipv4ToNum(base);
  const ipNum = ipv4ToNum(ip);
  if (baseNum === null || ipNum === null) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (baseNum & mask) === (ipNum & mask);
}

function ipv4ToNum(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const v = parseInt(p, 10);
    if (Number.isNaN(v) || v < 0 || v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}
