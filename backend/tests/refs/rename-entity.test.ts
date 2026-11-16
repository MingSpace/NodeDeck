import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 走真实文件系统:改名要同时写多个实体文件 + 搬缓存,mock 掉就测不到顺序和落盘结果
vi.mock("../../src/env.js", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "nodedeck-rename-"));
  return {
    env: {
      NODE_ENV: "test",
      PORT: 8080,
      DATA_DIR: dataDir,
      INITIAL_PASSWORD: "changeme",
      SESSION_SECRET: "test-secret-test-secret",
      LOG_LEVEL: "info",
      LOG_BUFFER_SIZE: 100,
    },
  };
});

import { ensureDataDirs, cachePath, moduleCachePath } from "../../src/storage/paths.js";
import { env } from "../../src/env.js";
import { egressRepo, profileRepo, providerRepo, proxyGroupRepo, surgeModuleRepo } from "../../src/storage/repos.js";
import { loadNotificationConfig, saveNotificationConfig } from "../../src/storage/notification-store.js";
import { writeJson, readJson } from "../../src/storage/yaml-io.js";
import { renameEntity, replaceIdAtPath, RenameError } from "../../src/refs/rename-entity.js";

describe("replaceIdAtPath", () => {
  it("replaces string leaves and array items along a.b[1].c paths", () => {
    const obj = { a: "x", list: ["x", "y", "x"], rules: [{ ref: "z" }, { ref: "x", sel: { from: ["x"] } }] };
    expect(replaceIdAtPath(obj, "a", "x", "n")).toBe(true);
    expect(replaceIdAtPath(obj, "list", "x", "n")).toBe(true);
    expect(replaceIdAtPath(obj, "rules[1].ref", "x", "n")).toBe(true);
    expect(replaceIdAtPath(obj, "rules[1].sel.from", "x", "n")).toBe(true);
    expect(replaceIdAtPath(obj, "rules[0].ref", "x", "n")).toBe(false);
    expect(replaceIdAtPath(obj, "missing.path", "x", "n")).toBe(false);
    expect(obj).toEqual({ a: "n", list: ["n", "y", "n"], rules: [{ ref: "z" }, { ref: "n", sel: { from: ["n"] } }] });
  });
});

describe("renameEntity (real fs)", () => {
  it("renames a provider and rewrites every id reference + moves its cache", async () => {
    await ensureDataDirs(env.DATA_DIR);
    await providerRepo.save({ id: "imported-abc", name: "机场 A", type: "http", url: "https://airport.example/sub" });
    await proxyGroupRepo.save({ id: "g", name: "Proxy", type: "select", selector: { from_providers: ["imported-abc"] } });
    await profileRepo.save({
      id: "p",
      name: "P",
      token: "token-abcdefgh",
      providers: ["imported-abc", "other"],
      userinfo: { enabled: true, primary_provider: "imported-abc" },
    });
    const notif = await loadNotificationConfig();
    notif.events.userinfo_alert.provider_ids = ["imported-abc"];
    await saveNotificationConfig(notif);
    await writeJson(cachePath("imported-abc"), { provider_id: "imported-abc", fetched_at: 1, status: "ok", nodes: [] });

    const res = await renameEntity("providers", "imported-abc", "airport-a");

    expect(await providerRepo.exists("imported-abc")).toBe(false);
    expect((await providerRepo.get("airport-a"))?.data.name).toBe("机场 A");
    const profile = (await profileRepo.get("p"))!.data;
    expect(profile.providers).toEqual(["airport-a", "other"]);
    expect(profile.userinfo.primary_provider).toBe("airport-a");
    expect((await proxyGroupRepo.get("g"))!.data.selector?.from_providers).toEqual(["airport-a"]);
    expect((await loadNotificationConfig()).events.userinfo_alert.provider_ids).toEqual(["airport-a"]);
    expect(existsSync(cachePath("imported-abc"))).toBe(false);
    expect(await readJson(cachePath("airport-a"))).toMatchObject({ status: "ok" });
    expect(res.updated.map((u) => `${u.kind}/${u.id}`).sort()).toEqual(["groups/g", "notification/notification", "profiles/p"]);
  });

  it("renames a module (profile.surge_modules) and an egress (remote module fetch_via)", async () => {
    await ensureDataDirs(env.DATA_DIR);
    await egressRepo.save({ id: "eg-old", name: "出口", type: "proxy", url: "http://127.0.0.1:1080" });
    await surgeModuleRepo.save({ id: "imported-module-x", name: "Rewrite", content_sections: { url_rewrite: "^a b 302" } });
    await surgeModuleRepo.save({
      id: "remote",
      name: "R",
      source: "remote",
      url: "https://example.com/r.sgmodule",
      fetch_via: ["eg-old"],
    });
    await profileRepo.save({ id: "p2", name: "P2", token: "token-abcdefgh", surge_modules: ["imported-module-x", "remote"] });
    await writeJson(moduleCachePath("imported-module-x"), { x: 1 });

    await renameEntity("modules", "imported-module-x", "rewrite-google");
    expect((await profileRepo.get("p2"))!.data.surge_modules).toEqual(["rewrite-google", "remote"]);
    expect(await surgeModuleRepo.exists("imported-module-x")).toBe(false);
    expect(existsSync(moduleCachePath("rewrite-google"))).toBe(true);

    await renameEntity("egresses", "eg-old", "eg-new");
    expect((await surgeModuleRepo.get("remote"))!.data.fetch_via).toEqual(["eg-new"]);
  });

  it("rejects same id, missing entity, and taken id without touching files", async () => {
    await ensureDataDirs(env.DATA_DIR);
    await surgeModuleRepo.save({ id: "a1", name: "A" });
    await surgeModuleRepo.save({ id: "b1", name: "B" });
    await expect(renameEntity("modules", "a1", "a1")).rejects.toMatchObject({ status: 400 });
    await expect(renameEntity("modules", "nope", "x1")).rejects.toMatchObject({ status: 404 });
    const taken = renameEntity("modules", "a1", "b1");
    await expect(taken).rejects.toBeInstanceOf(RenameError);
    await expect(taken).rejects.toMatchObject({ status: 409 });
    expect((await surgeModuleRepo.get("a1"))?.data.name).toBe("A");
    expect((await surgeModuleRepo.get("b1"))?.data.name).toBe("B");
  });
});
