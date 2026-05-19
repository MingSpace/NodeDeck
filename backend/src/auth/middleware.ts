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
