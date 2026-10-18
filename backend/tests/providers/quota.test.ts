import { describe, expect, it } from "vitest";
import { providerSchema, type ProviderQuota } from "../../src/schemas/provider.js";
import {
  describeQuotaExclusion,
  evaluateProviderQuota,
  nextResetAt,
  parseLocalDate,
} from "../../src/providers/quota.js";
import type { UserInfo } from "../../src/schemas/userinfo.js";

const GB = 1024 ** 3;
// 本地时区 2026-10-18 15:00,所有用例都按进程时区解释日期,与实现一致
const NOW = new Date(2026, 9, 18, 15, 0, 0).getTime();

function provider(quota?: Partial<ProviderQuota>, type: "http" | "inline" = "inline") {
  return providerSchema.parse({
    id: "p1",
    name: "FlowerCloud",
    type,
    ...(type === "http" ? { url: "https://sub.example.com/s" } : { content: "x" }),
    ...(quota ? { quota } : {}),
  });
}

function userinfo(usedGb: number, totalGb: number, expire = 0): UserInfo {
  return { upload: 0, download: usedGb * GB, total: totalGb * GB, expire };
}

describe("nextResetAt", () => {
  it("本月重置日还没到 → 本月", () => {
    expect(nextResetAt(20, NOW)).toBe(new Date(2026, 9, 20).getTime());
  });

  it("本月已过 → 下个月", () => {
    expect(nextResetAt(2, NOW)).toBe(new Date(2026, 10, 2).getTime());
  });

  it("恰好是今天零点之后 → 下个月,不会返回已过去的时刻", () => {
    expect(nextResetAt(18, NOW)).toBe(new Date(2026, 10, 18).getTime());
  });

  it("下个月没有 31 号 → 取月末", () => {
    const jan31 = new Date(2027, 0, 31, 12).getTime();
    expect(nextResetAt(31, jan31)).toBe(new Date(2027, 1, 28).getTime());
  });
});

describe("schema 日期校验", () => {
  it("拦住会被 Date 进位的非法日期", () => {
    expect(() => provider({ exhausted_until: "2026-02-30" })).toThrow(/无效日期/);
    expect(() => provider({ expire: "2026/11/02" })).toThrow(/YYYY-MM-DD/);
  });

  it("reset_day 只能 1~31", () => {
    expect(() => provider({ reset_day: 0 })).toThrow();
    expect(() => provider({ reset_day: 32 })).toThrow();
  });
});

describe("evaluateProviderQuota", () => {
  it("没配额信息 → 不排除", () => {
    expect(evaluateProviderQuota(provider(), undefined, NOW)).toEqual({ excluded: false });
  });

  it("在线源上游流量用完 → 排除,有重置日时给出恢复时间", () => {
    const s = evaluateProviderQuota(provider({ reset_day: 2 }, "http"), userinfo(153, 150), NOW);
    expect(s.excluded).toBe(true);
    expect(s.reason).toBe("traffic_exhausted");
    expect(s.restore_at).toBe(new Date(2026, 10, 2).getTime());
    expect(s.traffic).toEqual({ used: 153 * GB, total: 150 * GB });
  });

  it("上游流量没用完 → 不排除", () => {
    const s = evaluateProviderQuota(provider(undefined, "http"), userinfo(179, 200), NOW);
    expect(s.excluded).toBe(false);
    expect(s.reason).toBeUndefined();
  });

  it("total=0 视为不限量", () => {
    const s = evaluateProviderQuota(provider(undefined, "http"), userinfo(500, 0), NOW);
    expect(s.excluded).toBe(false);
    expect(s.traffic).toBeUndefined();
  });

  it("离线源手动标记用完 → 排除到标记日,过了自动恢复", () => {
    const p = provider({ exhausted_until: "2026-11-02" });
    const during = evaluateProviderQuota(p, undefined, NOW);
    expect(during.excluded).toBe(true);
    expect(during.reason).toBe("manual_exhausted");
    expect(during.restore_at).toBe(parseLocalDate("2026-11-02"));

    const after = evaluateProviderQuota(p, undefined, new Date(2026, 10, 2, 0, 0, 1).getTime());
    expect(after.excluded).toBe(false);
  });

  it("上游 expire 已过 → 排除,且优先于手填到期日", () => {
    const pastSec = Math.floor(NOW / 1000) - 60;
    const s = evaluateProviderQuota(provider({ expire: "2030-01-01" }, "http"), userinfo(1, 100, pastSec), NOW);
    expect(s.excluded).toBe(true);
    expect(s.reason).toBe("expired");
    expect(s.expire_source).toBe("upstream");
  });

  it("离线源手填到期日已过 → 排除;未到 → 只展示", () => {
    expect(evaluateProviderQuota(provider({ expire: "2026-10-01" }), undefined, NOW).reason).toBe("expired");
    const future = evaluateProviderQuota(provider({ expire: "2027-04-02" }), undefined, NOW);
    expect(future.excluded).toBe(false);
    expect(future.expire_at).toBe(parseLocalDate("2027-04-02"));
    expect(future.expire_source).toBe("manual");
  });

  it("auto_exclude 关闭 → 给出原因但不排除", () => {
    const s = evaluateProviderQuota(provider({ auto_exclude: false, exhausted_until: "2026-11-02" }), undefined, NOW);
    expect(s.reason).toBe("manual_exhausted");
    expect(s.excluded).toBe(false);
  });
});

describe("describeQuotaExclusion", () => {
  it("带恢复日期", () => {
    const s = evaluateProviderQuota(provider({ exhausted_until: "2026-11-02" }), undefined, NOW);
    expect(describeQuotaExclusion("FlowerCloud", s)).toBe(
      "节点源「FlowerCloud」流量已用完(手动标记),已从订阅中临时排除,预计 2026-11-02 恢复",
    );
  });

  it("在线源没配重置日 → 说明下次刷新恢复", () => {
    const s = evaluateProviderQuota(provider(undefined, "http"), userinfo(150, 150), NOW);
    expect(describeQuotaExclusion("K", s)).toContain("下次刷新自动恢复");
  });
});
