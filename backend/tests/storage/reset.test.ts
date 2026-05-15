import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, writeFile, readFile, readdir, unlink } from "node:fs/promises";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";

// reset 走真实 fs:vi.mock 是 hoisted 的,工厂里不能引用 top-level 变量,
// 因此用 mkdtempSync 在工厂内部同步建好目录,再通过 env.DATA_DIR 暴露给测试体使用。
vi.mock("../../src/env.js", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "mconvert-reset-"));
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

import { resetData } from "../../src/storage/reset.js";
import { configPath, dataPath, manualNodesPath } from "../../src/storage/paths.js";
import { env } from "../../src/env.js";

async function seed(): Promise<void> {
  // 全套 data 目录:一个 yaml + 一个 cache json + manual-nodes + config
  for (const sub of ["providers", "rules", "groups", "modules", "general", "profiles", "cache"]) {
    await mkdir(dataPath(sub), { recursive: true });
  }
  await writeFile(dataPath("providers", "p1.yaml"), "id: p1\n");
  await writeFile(dataPath("providers", "p2.yaml"), "id: p2\n");
  await writeFile(dataPath("rules", "r1.yaml"), "id: r1\n");
  await writeFile(dataPath("groups", "g1.yaml"), "id: g1\n");
  await writeFile(dataPath("modules", "m1.yaml"), "id: m1\n");
  await writeFile(dataPath("general", "gen1.yaml"), "id: gen1\n");
  await writeFile(dataPath("profiles", "home.yaml"), "id: home\n");
  await writeFile(dataPath("cache", "p1.json"), "{}");
  await writeFile(manualNodesPath(), "nodes: []\n");
  // config.yaml 包含完整 admin 段 — 这是最关键的不变量,reset 后必须仍然在。
  const cfg = {
    admin: {
      username: "admin",
      password_hash: "$2a$10$fakehash",
      must_change_password: false,
    },
    ip_allowlist: ["10.0.0.0/8"],
    public_base_url: "https://example.com",
    default_user_agent: "CustomUA/1.0",
  };
  await writeFile(configPath(), yaml.dump(cfg));
}

beforeEach(async () => {
  await seed();
});

afterEach(async () => {
  // 清空目录里残留,防止用例间相互污染。下一个 beforeEach 会重新 seed。
  if (!existsSync(env.DATA_DIR)) return;
  for (const sub of ["providers", "rules", "groups", "modules", "general", "profiles", "cache"]) {
    const dir = dataPath(sub);
    if (!existsSync(dir)) continue;
    for (const name of await readdir(dir)) {
      try {
        await unlink(join(dir, name));
      } catch {
        // ignore
      }
    }
  }
  for (const f of [manualNodesPath(), configPath()]) {
    if (existsSync(f)) {
      try {
        await unlink(f);
      } catch {
        // ignore
      }
    }
  }
});

describe("resetData", () => {
  it("管理员账号永远不会被删除(全选 + 包含 service_settings 也保留 admin)", async () => {
    await resetData({
      providers: true,
      rules: true,
      groups: true,
      modules: true,
      general: true,
      profiles: true,
      manual_nodes: true,
      cache: true,
      service_settings: true,
    });

    expect(existsSync(configPath())).toBe(true);
    const text = await readFile(configPath(), "utf8");
    const cfg = yaml.load(text) as {
      admin: { username: string; password_hash: string; must_change_password: boolean };
      ip_allowlist: string[];
      default_user_agent: string;
      public_base_url?: string;
    };
    expect(cfg.admin.username).toBe("admin");
    expect(cfg.admin.password_hash).toBe("$2a$10$fakehash");
    expect(cfg.admin.must_change_password).toBe(false);

    // service_settings 重置:白名单清空、UA 回默认、public_base_url 清空
    expect(cfg.ip_allowlist).toEqual([]);
    expect(cfg.default_user_agent).toBe("Surge/2400");
    expect(cfg.public_base_url ?? "").toBe("");
  });

  it("按 scope 精确删除:只删勾选的目录,未勾选的保留", async () => {
    const result = await resetData({
      providers: true,
      rules: false,
      groups: false,
      modules: false,
      general: false,
      profiles: false,
      manual_nodes: false,
      cache: false,
      service_settings: false,
    });

    // providers 全删,且 cache 跟着 providers 联动一起清(防止无主缓存)
    expect(await readdir(dataPath("providers"))).toEqual([]);
    expect(await readdir(dataPath("cache"))).toEqual([]);
    expect(result.removed.providers).toBe(2);
    expect(result.removed.cache).toBe(1);

    // 其它目录原封不动
    expect(await readdir(dataPath("rules"))).toEqual(["r1.yaml"]);
    expect(await readdir(dataPath("groups"))).toEqual(["g1.yaml"]);
    expect(await readdir(dataPath("modules"))).toEqual(["m1.yaml"]);
    expect(await readdir(dataPath("general"))).toEqual(["gen1.yaml"]);
    expect(await readdir(dataPath("profiles"))).toEqual(["home.yaml"]);
    expect(existsSync(manualNodesPath())).toBe(true);
  });

  it("scope 全为 false 时不删任何文件", async () => {
    const result = await resetData({});
    expect(result.removed).toEqual({
      providers: 0,
      rules: 0,
      groups: 0,
      modules: 0,
      general: 0,
      profiles: 0,
      manual_nodes: 0,
      cache: 0,
      service_settings: false,
    });
    // 文件全部还在
    expect(await readdir(dataPath("providers"))).toHaveLength(2);
    expect(await readdir(dataPath("cache"))).toHaveLength(1);
    expect(existsSync(manualNodesPath())).toBe(true);
  });

  it("manual_nodes 单独勾选时只删 manual-nodes.yaml", async () => {
    const result = await resetData({ manual_nodes: true });
    expect(result.removed.manual_nodes).toBe(1);
    expect(existsSync(manualNodesPath())).toBe(false);
    // providers 和 cache 没动
    expect(await readdir(dataPath("providers"))).toHaveLength(2);
    expect(await readdir(dataPath("cache"))).toHaveLength(1);
  });

  it("service_settings 单独勾选时不动任何 yaml 实体,只重置 config.yaml 的服务字段", async () => {
    const result = await resetData({ service_settings: true });

    expect(result.removed.service_settings).toBe(true);
    expect(result.removed.providers).toBe(0);

    // 实体目录不动
    expect(await readdir(dataPath("providers"))).toHaveLength(2);
    expect(await readdir(dataPath("rules"))).toHaveLength(1);

    // config.yaml admin 保留 + 服务字段被重置
    const cfg = yaml.load(await readFile(configPath(), "utf8")) as {
      admin: { password_hash: string };
      ip_allowlist: string[];
      default_user_agent: string;
    };
    expect(cfg.admin.password_hash).toBe("$2a$10$fakehash");
    expect(cfg.ip_allowlist).toEqual([]);
    expect(cfg.default_user_agent).toBe("Surge/2400");
  });
});
