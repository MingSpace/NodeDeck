import { afterEach, describe, expect, it, vi } from "vitest";

// 缓存文件读写换成内存 Map,不碰真实 data/
const files = new Map<string, unknown>();
vi.mock("../../src/storage/yaml-io.js", () => ({
  readJson: vi.fn(async (p: string) => files.get(p) ?? null),
  writeJson: vi.fn(async (p: string, d: unknown) => {
    files.set(p, JSON.parse(JSON.stringify(d)));
  }),
}));

import { loadRemoteModule, readModuleCache, REMOTE_MODULE_TTL_MS } from "../../src/surge-modules/remote.js";

const mod = { id: "m1", url: "https://example.com/m.sgmodule", fetch_via: [] as string[] };
const TEXT = "#!name=M\n[Rule]\nDOMAIN,a.example.com,REJECT\n";

afterEach(() => {
  files.clear();
});

describe("loadRemoteModule", () => {
  it("fetches once, then serves cache within TTL; refetches after TTL or when forced", async () => {
    const fetchText = vi.fn().mockResolvedValue({ text: TEXT, fetched_at: 1000 });
    const first = await loadRemoteModule(mod, { fetchText, now: 1000 });
    expect(first).toMatchObject({ status: "ok", text: TEXT, ok_at: 1000 });
    expect(fetchText).toHaveBeenCalledTimes(1);
    expect(fetchText.mock.calls[0][0]).toBe(mod.url);

    await loadRemoteModule(mod, { fetchText, now: 1000 + REMOTE_MODULE_TTL_MS - 1 });
    expect(fetchText).toHaveBeenCalledTimes(1);

    await loadRemoteModule(mod, { fetchText, now: 1000 + REMOTE_MODULE_TTL_MS + 1 });
    expect(fetchText).toHaveBeenCalledTimes(2);

    await loadRemoteModule(mod, { fetchText, now: 1001, force: true });
    expect(fetchText).toHaveBeenCalledTimes(3);
  });

  it("keeps the last good text on failure and backs off for a TTL", async () => {
    const ok = vi.fn().mockResolvedValue({ text: TEXT, fetched_at: 1000 });
    await loadRemoteModule(mod, { fetchText: ok, now: 1000 });

    const fail = vi.fn().mockRejectedValue(new Error("HTTP 404"));
    const later = 1000 + REMOTE_MODULE_TTL_MS + 1;
    const res = await loadRemoteModule(mod, { fetchText: fail, now: later });
    expect(res).toMatchObject({ status: "error", error: "HTTP 404", text: TEXT, ok_at: 1000, fetched_at: later });

    // 失败后同样按 TTL 退避,不会每个请求都打上游
    await loadRemoteModule(mod, { fetchText: fail, now: later + 1 });
    expect(fail).toHaveBeenCalledTimes(1);
  });

  it("drops the cache when the URL changes", async () => {
    await loadRemoteModule(mod, { fetchText: vi.fn().mockResolvedValue({ text: TEXT, fetched_at: 1000 }), now: 1000 });
    const fail = vi.fn().mockRejectedValue(new Error("boom"));
    const res = await loadRemoteModule({ ...mod, url: "https://example.com/other.sgmodule" }, { fetchText: fail, now: 1001 });
    expect(fail).toHaveBeenCalledTimes(1);
    expect(res.text).toBeUndefined();
    expect((await readModuleCache("m1"))?.url).toBe("https://example.com/other.sgmodule");
  });

  it("dedupes concurrent refreshes of the same module", async () => {
    let resolve!: (v: { text: string; fetched_at: number }) => void;
    const fetchText = vi.fn().mockReturnValue(new Promise((r) => (resolve = r)));
    const a = loadRemoteModule(mod, { fetchText, now: 1000 });
    const b = loadRemoteModule(mod, { fetchText, now: 1000 });
    // 两个调用都要先读完缓存才会登记 inflight
    await new Promise((r) => setTimeout(r, 0));
    resolve({ text: TEXT, fetched_at: 1000 });
    await Promise.all([a, b]);
    expect(fetchText).toHaveBeenCalledTimes(1);
  });
});
