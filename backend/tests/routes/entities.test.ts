import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import type { Provider } from "../../src/schemas/provider.js";

vi.mock("../../src/storage/repos.js", () => ({
  providerRepo: { save: vi.fn(), exists: vi.fn() },
  rulesetRepo: { save: vi.fn(), exists: vi.fn() },
  proxyGroupRepo: { save: vi.fn(), exists: vi.fn() },
  generalPresetRepo: { save: vi.fn(), exists: vi.fn() },
  surgeModuleRepo: { save: vi.fn(), exists: vi.fn() },
  profileRepo: { save: vi.fn(), exists: vi.fn() },
}));
vi.mock("../../src/providers/load.js", () => ({
  refreshProvider: vi.fn(),
}));
vi.mock("../../src/storage/manual-nodes.js", () => ({
  readManualNodes: vi.fn(),
  writeManualNodes: vi.fn(),
}));

import { providerRepo, rulesetRepo } from "../../src/storage/repos.js";
import { refreshProvider } from "../../src/providers/load.js";
import { entitiesRouter } from "../../src/routes/entities.js";
import type { RuleSet } from "../../src/schemas/ruleset.js";

const mockedProviderSave = providerRepo.save as unknown as ReturnType<typeof vi.fn>;
const mockedProviderExists = providerRepo.exists as unknown as ReturnType<typeof vi.fn>;
const mockedRulesetSave = rulesetRepo.save as unknown as ReturnType<typeof vi.fn>;
const mockedRulesetExists = rulesetRepo.exists as unknown as ReturnType<typeof vi.fn>;
const mockedRefresh = refreshProvider as unknown as ReturnType<typeof vi.fn>;

function buildApp(): Hono {
  const app = new Hono();
  app.route("/api/entities", entitiesRouter);
  return app;
}

function fakeProviderBody(overrides: Partial<Provider> = {}): Record<string, unknown> {
  return {
    id: "airport-a",
    name: "Airport A",
    type: "http",
    url: "https://example.com/sub",
    user_agent: "Surge/2400",
    refresh: { interval: "12h" },
    parser_hint: "auto",
    enabled: true,
    tags: [],
    clash_proxy_provider: {
      enabled: false,
      health_check_url: "http://www.gstatic.com/generate_204",
      health_check_interval: 300,
    },
    ...overrides,
  };
}

function savedProvider(body: Record<string, unknown>): { id: string; path: string; mtimeMs: number; data: Provider } {
  return { id: body.id as string, path: "", mtimeMs: 0, data: body as unknown as Provider };
}

function fakeRulesetBody(overrides: Partial<RuleSet> = {}): Record<string, unknown> {
  return {
    id: "rs-1",
    name: "ruleset 1",
    type: "inline_list",
    payload: ["DOMAIN-SUFFIX,example.com"],
    behavior: "classical",
    format: "yaml",
    clash_format: "inline",
    surge_format: "inline_ruleset",
    update_interval: 86400,
    ...overrides,
  };
}

beforeEach(() => {
  mockedRefresh.mockResolvedValue({
    provider_id: "airport-a",
    fetched_at: Date.now(),
    status: "ok",
    nodes: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/entities/:kind", () => {
  it("providers + enabled=true → triggers async refresh", async () => {
    const body = fakeProviderBody({ enabled: true });
    mockedProviderSave.mockResolvedValue(savedProvider(body));

    const res = await buildApp().request("/api/entities/providers", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(mockedRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ id: "airport-a", enabled: true }),
      { force: true },
    );
  });

  it("providers + enabled=false → does NOT trigger refresh", async () => {
    const body = fakeProviderBody({ enabled: false });
    mockedProviderSave.mockResolvedValue(savedProvider(body));

    const res = await buildApp().request("/api/entities/providers", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it("non-provider kind (rules) → does NOT trigger refresh", async () => {
    const body = fakeRulesetBody();
    mockedRulesetSave.mockResolvedValue({ id: body.id as string, path: "", mtimeMs: 0, data: body });

    const res = await buildApp().request("/api/entities/rules", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(201);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it("validation failure → 400 + no save + no refresh", async () => {
    const res = await buildApp().request("/api/entities/providers", {
      method: "POST",
      body: JSON.stringify({ id: "x", type: "http" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(400);
    expect(mockedProviderSave).not.toHaveBeenCalled();
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it("unknown kind → 404 + no refresh", async () => {
    const res = await buildApp().request("/api/entities/bogus", {
      method: "POST",
      body: JSON.stringify({ id: "x" }),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(404);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });
});

describe("PUT /api/entities/:kind/:id", () => {
  it("providers + new file (exists=false) + enabled=true → triggers refresh", async () => {
    const body = fakeProviderBody();
    mockedProviderExists.mockResolvedValue(false);
    mockedProviderSave.mockResolvedValue(savedProvider(body));

    const res = await buildApp().request("/api/entities/providers/airport-a", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
  });

  it("providers + http + existing file (exists=true) → does NOT trigger refresh (edit semantics, avoid hammering airport)", async () => {
    const body = fakeProviderBody({ type: "http" });
    mockedProviderExists.mockResolvedValue(true);
    mockedProviderSave.mockResolvedValue(savedProvider(body));

    const res = await buildApp().request("/api/entities/providers/airport-a", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it("providers + inline + existing file + enabled=true → triggers refresh (save-as-resync semantics)", async () => {
    const body = fakeProviderBody({
      type: "inline",
      url: undefined,
      content: "🇨🇳 TW = trojan, t.example.com, 443, password=pw",
    });
    mockedProviderExists.mockResolvedValue(true);
    mockedProviderSave.mockResolvedValue(savedProvider(body));

    const res = await buildApp().request("/api/entities/providers/airport-a", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    expect(mockedRefresh).toHaveBeenCalledWith(
      expect.objectContaining({ id: "airport-a", type: "inline", enabled: true }),
      { force: true },
    );
  });

  it("providers + inline + existing file + enabled=false → does NOT trigger refresh", async () => {
    const body = fakeProviderBody({
      type: "inline",
      url: undefined,
      content: "🇨🇳 TW = trojan, t.example.com, 443, password=pw",
      enabled: false,
    });
    mockedProviderExists.mockResolvedValue(true);
    mockedProviderSave.mockResolvedValue(savedProvider(body));

    const res = await buildApp().request("/api/entities/providers/airport-a", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it("providers + new file + enabled=false → does NOT trigger refresh", async () => {
    const body = fakeProviderBody({ enabled: false });
    mockedProviderExists.mockResolvedValue(false);
    mockedProviderSave.mockResolvedValue(savedProvider(body));

    const res = await buildApp().request("/api/entities/providers/airport-a", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it("non-provider kind (rules) + new file → does NOT trigger refresh", async () => {
    const body = fakeRulesetBody();
    mockedRulesetExists.mockResolvedValue(false);
    mockedRulesetSave.mockResolvedValue({ id: body.id as string, path: "", mtimeMs: 0, data: body });

    const res = await buildApp().request("/api/entities/rules/rs-1", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(mockedRefresh).not.toHaveBeenCalled();
  });

  it("refresh failure is swallowed (does NOT crash request)", async () => {
    const body = fakeProviderBody();
    mockedProviderExists.mockResolvedValue(false);
    mockedProviderSave.mockResolvedValue(savedProvider(body));
    mockedRefresh.mockRejectedValue(new Error("network down"));

    const res = await buildApp().request("/api/entities/providers/airport-a", {
      method: "PUT",
      body: JSON.stringify(body),
      headers: { "Content-Type": "application/json" },
    });

    expect(res.status).toBe(200);
    expect(mockedRefresh).toHaveBeenCalledTimes(1);
    // 让 microtask 跑一下,确认 .catch 拿到错误后不抛(否则会有 unhandled rejection)
    await new Promise((r) => setImmediate(r));
  });
});
