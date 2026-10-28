import { describe, expect, it, vi } from "vitest";
import type { Context } from "hono";

const conn = vi.hoisted(() => ({ address: "127.0.0.1" }));
vi.mock("@hono/node-server/conninfo", () => ({
  getConnInfo: () => ({ remote: { address: conn.address } }),
}));
vi.mock("../../src/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/env.js")>();
  return { ...actual, env: { ...actual.env, DEV_AUTH_BYPASS: true } };
});

import { envSchema } from "../../src/env.js";
import { isDevAuthBypassed } from "../../src/auth/dev-bypass.js";

function ctx(headers: Record<string, string> = {}): Context {
  return { req: { header: (k: string) => headers[k.toLowerCase()] } } as unknown as Context;
}

describe("DEV_AUTH_BYPASS", () => {
  it("生产环境拒绝开启", () => {
    expect(envSchema.safeParse({ NODE_ENV: "production", DEV_AUTH_BYPASS: "1" }).success).toBe(false);
    expect(envSchema.parse({ NODE_ENV: "development", DEV_AUTH_BYPASS: "1" }).DEV_AUTH_BYPASS).toBe(true);
    expect(envSchema.parse({}).DEV_AUTH_BYPASS).toBe(false);
  });

  it("只放行本机回环地址", () => {
    conn.address = "127.0.0.1";
    expect(isDevAuthBypassed(ctx())).toBe(true);
    conn.address = "::1";
    expect(isDevAuthBypassed(ctx())).toBe(true);
    conn.address = "192.168.1.20";
    expect(isDevAuthBypassed(ctx())).toBe(false);
  });

  it("带转发头(本机反代转进来的外部请求)不放行", () => {
    conn.address = "127.0.0.1";
    expect(isDevAuthBypassed(ctx({ "x-forwarded-for": "203.0.113.5" }))).toBe(false);
    expect(isDevAuthBypassed(ctx({ "x-real-ip": "203.0.113.5" }))).toBe(false);
  });
});
