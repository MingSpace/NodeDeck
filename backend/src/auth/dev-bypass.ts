import type { Context } from "hono";
import { getConnInfo } from "@hono/node-server/conninfo";
import { env } from "../env.js";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * 本地开发免登录(DEV_AUTH_BYPASS=1,见 `pnpm dev:verify`):agent 用浏览器验证 UI 时不必每次手输密码。
 * 三道闸,缺一不放行:
 * 1. env 显式打开,且 NODE_ENV 不是 production(env.ts 直接拒绝启动)
 * 2. TCP 对端是本机回环地址:vite 反代过来的就是 127.0.0.1;局域网机器直连 0.0.0.0 不放行
 * 3. 不带转发头:本机反代(nginx 等)把外部请求转进来时会带 X-Forwarded-For / X-Real-IP,不放行
 */
export function isDevAuthBypassed(c: Context): boolean {
  if (!env.DEV_AUTH_BYPASS) return false;
  if (c.req.header("x-forwarded-for") || c.req.header("x-real-ip")) return false;
  try {
    return LOOPBACK.has(getConnInfo(c).remote.address ?? "");
  } catch {
    // 不是经 @hono/node-server 进来的请求(如单测里直接调 app.fetch),拿不到对端地址
    return false;
  }
}
