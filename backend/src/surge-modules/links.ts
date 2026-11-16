import type { Context } from "hono";
import { env } from "../env.js";
import { loadConfig } from "../storage/config-store.js";

/** 与 routes/sub.ts 的 /module/:file 路由保持同步 */
export function modulePublicPath(id: string): string {
  return `/module/${id}.sgmodule`;
}

export async function publicBaseUrl(c: Context): Promise<string> {
  const cfg = await loadConfig();
  return cfg.public_base_url ?? env.PUBLIC_BASE_URL ?? new URL(c.req.url).origin;
}

/**
 * 设备上安装用的链接:模块地址 + Surge 的一键安装 URL scheme
 * (`surge:///install-module?url=<percent-encoded>`,manual.nssurge.com/tools/url-scheme.html)。
 */
export function moduleLinks(baseUrl: string, id: string): { url: string; install_url: string } {
  const url = `${baseUrl.replace(/\/+$/, "")}${modulePublicPath(id)}`;
  return { url, install_url: `surge:///install-module?url=${encodeURIComponent(url)}` };
}
