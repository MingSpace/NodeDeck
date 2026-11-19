import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// DATA_DIR 指向临时目录,避免测试污染仓库里的 data/
const DATA_DIR = vi.hoisted(
  () => `${process.env.TMPDIR?.replace(/\/$/, "") ?? "/tmp"}/nodedeck-pull-stats-${process.pid}`,
);

vi.mock("../../src/env.js", () => ({
  env: {
    NODE_ENV: "test",
    PORT: 8080,
    DATA_DIR,
    INITIAL_PASSWORD: "changeme",
    SESSION_SECRET: "test-secret-test-secret",
    LOG_LEVEL: "info",
    LOG_BUFFER_SIZE: 10,
  },
}));

import {
  _resetPullStats,
  classifyClient,
  dayKey,
  flushPullStats,
  initPullStats,
  prunePullStats,
  recordPull,
  recordRejected,
  summarizePulls,
  type PullStats,
} from "../../src/stats/pull-stats.js";

const DAY = 86_400_000;
// 固定在本地中午,避开跨零点
const NOW = new Date(2026, 10, 16, 12, 0, 0).getTime();

beforeEach(() => {
  rmSync(DATA_DIR, { recursive: true, force: true });
  _resetPullStats();
});

afterEach(() => {
  _resetPullStats();
  rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("classifyClient", () => {
  it.each([
    ["Surge iOS/3456", "Surge iOS"],
    ["Surge Mac/2890", "Surge Mac"],
    ["Surge/2400", "Surge"],
    ["clash-verge/v2.0.3", "Clash Verge"],
    ["mihomo/1.19.0", "mihomo"],
    ["ClashMetaForAndroid/2.11.5.Meta", "Clash Meta Android"],
    ["clash.meta", "mihomo"],
    ["Stash/2.5.0 Clash/1.9.0", "Stash"],
    ["curl/8.7.1", "curl"],
    [undefined, "未知客户端"],
    ["  ", "未知客户端"],
  ])("%s → %s", (ua, expected) => {
    expect(classifyClient(ua)).toBe(expected);
  });
});

describe("recordPull / summarizePulls", () => {
  it("按天计数,空日子补 0", () => {
    recordPull({ profileId: "home", ip: "1.1.1.1", userAgent: "Surge iOS/1", now: NOW });
    recordPull({ profileId: "home", ip: "2.2.2.2", userAgent: "Surge Mac/1", now: NOW });
    recordPull({ profileId: "work", ip: "1.1.1.1", userAgent: "Surge iOS/1", now: NOW - 2 * DAY });

    const s = summarizePulls(7, NOW);
    expect(s.days).toHaveLength(7);
    expect(s.days[6]).toEqual({ date: dayKey(NOW), count: 2 });
    expect(s.days[4]).toEqual({ date: dayKey(NOW - 2 * DAY), count: 1 });
    expect(s.days[5]).toEqual({ date: dayKey(NOW - DAY), count: 0 });
    expect(s.today).toBe(2);
    expect(s.since).toBe(dayKey(NOW - 2 * DAY));
    expect(s.profiles.home).toEqual({ last7: 2, last_pull_at: NOW });
    expect(s.profiles.work.last7).toBe(1);
  });

  it("同一 IP + 客户端算一台设备,累计次数;最近的排前面", () => {
    recordPull({ profileId: "home", ip: "1.1.1.1", userAgent: "Surge iOS/1", now: NOW - 3000 });
    recordPull({ profileId: "home", ip: "2.2.2.2", userAgent: "Surge Mac/1", now: NOW - 2000 });
    recordPull({ profileId: "home", ip: "1.1.1.1", userAgent: "Surge iOS/2", now: NOW - 1000 });

    const { devices } = summarizePulls(30, NOW);
    expect(devices.map((d) => [d.ip, d.client, d.count])).toEqual([
      ["1.1.1.1", "Surge iOS", 2],
      ["2.2.2.2", "Surge Mac", 1],
    ]);
    expect(devices[0].user_agent).toBe("Surge iOS/2");
    expect(devices[0]).not.toHaveProperty("target");
  });

  it("设备只返回最近 7 天拉过的", () => {
    recordPull({ profileId: "home", ip: "1.1.1.1", now: NOW - 8 * DAY });
    recordPull({ profileId: "home", ip: "2.2.2.2", now: NOW - DAY });
    expect(summarizePulls(30, NOW).devices.map((d) => d.ip)).toEqual(["2.2.2.2"]);
  });

  it("token 不对的请求单独计数,不算拉取", () => {
    recordRejected(NOW);
    recordRejected(NOW);
    const s = summarizePulls(30, NOW);
    expect(s.rejected).toBe(2);
    expect(s.today).toBe(0);
  });
});

describe("prunePullStats", () => {
  it("删掉 90 天前的日子和 30 天没出现的设备", () => {
    const stats: PullStats = {
      version: 1,
      days: {
        [dayKey(NOW - 100 * DAY)]: { profiles: { home: { surge: 1 } }, rejected: 0 },
        [dayKey(NOW - 10 * DAY)]: { profiles: { home: { surge: 1 } }, rejected: 0 },
      },
      last_pulls: {},
      devices: {
        old: { ip: "1.1.1.1", client: "Surge", user_agent: "", profile_id: "home", first_seen: 0, last_seen: NOW - 31 * DAY, count: 1 },
        new: { ip: "2.2.2.2", client: "Surge", user_agent: "", profile_id: "home", first_seen: 0, last_seen: NOW - DAY, count: 1 },
      },
    };
    prunePullStats(stats, NOW);
    expect(Object.keys(stats.days)).toEqual([dayKey(NOW - 10 * DAY)]);
    expect(Object.keys(stats.devices)).toEqual(["new"]);
  });
});

describe("落盘", () => {
  const file = () => join(DATA_DIR, "stats", "pulls.json");

  it("没有新计数不写文件;有计数写 stats/pulls.json,重启后读回", async () => {
    await flushPullStats();
    expect(existsSync(file())).toBe(false);

    recordPull({ profileId: "home", ip: "1.1.1.1", userAgent: "Surge iOS/1" });
    await flushPullStats();
    const saved = JSON.parse(readFileSync(file(), "utf8")) as PullStats;
    expect(Object.values(saved.days)[0].profiles.home).toEqual({ surge: 1 });

    _resetPullStats();
    await initPullStats();
    expect(summarizePulls(1).today).toBe(1);
  });

  // 旧版分过 Clash 桶、设备上记了 target:"clash";这样的历史文件必须整份能读,不能"starting fresh"
  it("含 Clash 拉取的历史文件照常加载:只计 Surge,Clash 设备不再返回", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(DATA_DIR, "stats"), { recursive: true });
    const now = Date.now();
    writeFileSync(
      file(),
      JSON.stringify({
        version: 1,
        days: { [dayKey(now)]: { profiles: { home: { clash: 5, surge: 2 } }, rejected: 1 } },
        last_pulls: { home: now },
        devices: {
          "1.1.1.1|Surge iOS": { ip: "1.1.1.1", client: "Surge iOS", user_agent: "Surge iOS/1", profile_id: "home", target: "surge", first_seen: now, last_seen: now, count: 2 },
          "2.2.2.2|mihomo": { ip: "2.2.2.2", client: "mihomo", user_agent: "mihomo/1", profile_id: "home", target: "clash", first_seen: now, last_seen: now, count: 5 },
          "3.3.3.3|Surge Mac": { ip: "3.3.3.3", client: "Surge Mac", user_agent: "Surge Mac/1", profile_id: "home", first_seen: now, last_seen: now, count: 1 },
        },
      }),
    );
    await initPullStats();
    const s = summarizePulls(1);
    expect(s.today).toBe(2);
    expect(s.days[0].count).toBe(2);
    expect(s.rejected).toBe(1);
    expect(s.profiles.home.last7).toBe(2);
    expect(s.devices.map((d) => d.ip).sort()).toEqual(["1.1.1.1", "3.3.3.3"]);
    expect(s.devices.every((d) => !("target" in d))).toBe(true);

    // 下一次拉取写进同一天,旧的 clash 计数不会被带回来
    recordPull({ profileId: "home", ip: "1.1.1.1", userAgent: "Surge iOS/1" });
    await flushPullStats();
    const saved = JSON.parse(readFileSync(file(), "utf8")) as PullStats;
    expect(saved.days[dayKey(now)].profiles.home).toEqual({ surge: 3 });
  });

  it("文件内容非法时从空的开始,不抛错", async () => {
    const { mkdirSync, writeFileSync } = await import("node:fs");
    mkdirSync(join(DATA_DIR, "stats"), { recursive: true });
    writeFileSync(file(), JSON.stringify({ version: 99 }));
    await expect(initPullStats()).resolves.toBeUndefined();
    expect(summarizePulls(1).today).toBe(0);
  });
});
