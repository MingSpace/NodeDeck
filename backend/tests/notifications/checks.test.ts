import { describe, expect, it } from "vitest";
import { checkUserinfo, formatBytes } from "../../src/notifications/checks.js";

const DAY = 86_400_000;
const GB = 1024 ** 3;
const NOW = 1_750_000_000_000;

const thresholds = { expire_days: 3, traffic_percent: 5 };

describe("checkUserinfo - 到期时间", () => {
  it("剩余天数 > 阈值时不触发", () => {
    const r = checkUserinfo(
      { upload: 0, download: 0, total: 0, expire: Math.floor((NOW + 10 * DAY) / 1000) },
      thresholds,
      NOW,
    );
    expect(r.expire?.triggered).toBe(false);
    expect(r.expire?.daysLeft).toBeCloseTo(10, 1);
  });

  it("剩余天数 <= 阈值时触发", () => {
    const r = checkUserinfo(
      { upload: 0, download: 0, total: 0, expire: Math.floor((NOW + 2 * DAY) / 1000) },
      thresholds,
      NOW,
    );
    expect(r.expire?.triggered).toBe(true);
  });

  it("已过期(剩余为负)也触发", () => {
    const r = checkUserinfo(
      { upload: 0, download: 0, total: 0, expire: Math.floor((NOW - DAY) / 1000) },
      thresholds,
      NOW,
    );
    expect(r.expire?.triggered).toBe(true);
    expect(r.expire!.daysLeft).toBeLessThan(0);
  });

  it("expire=0(上游未提供)时跳过该维度", () => {
    const r = checkUserinfo({ upload: 0, download: 0, total: 100, expire: 0 }, thresholds, NOW);
    expect(r.expire).toBeUndefined();
  });
});

describe("checkUserinfo - 剩余流量", () => {
  it("剩余百分比 > 阈值时不触发", () => {
    const r = checkUserinfo(
      { upload: 10 * GB, download: 40 * GB, total: 100 * GB, expire: 0 },
      thresholds,
      NOW,
    );
    expect(r.traffic?.triggered).toBe(false);
    expect(r.traffic?.percentLeft).toBeCloseTo(50, 1);
  });

  it("剩余百分比 <= 阈值时触发", () => {
    const r = checkUserinfo(
      { upload: 50 * GB, download: 46 * GB, total: 100 * GB, expire: 0 },
      thresholds,
      NOW,
    );
    expect(r.traffic?.triggered).toBe(true);
    expect(r.traffic?.percentLeft).toBeCloseTo(4, 1);
  });

  it("用量超过 total 时剩余按 0 计且触发", () => {
    const r = checkUserinfo(
      { upload: 80 * GB, download: 30 * GB, total: 100 * GB, expire: 0 },
      thresholds,
      NOW,
    );
    expect(r.traffic?.triggered).toBe(true);
    expect(r.traffic?.remainingBytes).toBe(0);
  });

  it("total=0(上游未提供)时跳过该维度", () => {
    const r = checkUserinfo({ upload: GB, download: GB, total: 0, expire: 0 }, thresholds, NOW);
    expect(r.traffic).toBeUndefined();
  });
});

describe("formatBytes", () => {
  it("常见量级", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(5 * GB)).toBe("5.0 GB");
    expect(formatBytes(200 * GB)).toBe("200 GB");
  });
});
