import { describe, expect, it } from "vitest";
import { extractInfoNodeQuota } from "../../src/parsers/info-node-extract.js";
import { isInfoNode } from "../../src/parsers/info-node-filter.js";

const GB = 1024 ** 3;
const FETCHED = new Date(2026, 9, 9, 15, 30).getTime();

describe("extractInfoNodeQuota", () => {
  it("FlowerCloud 形态:Traffic 已用 | 总量 + Expire", () => {
    expect(extractInfoNodeQuota(["Traffic: 73.93 GB | 150 GB", "Expire: 2027-04-02"], FETCHED)).toEqual({
      traffic: { used: Math.round(73.93 * GB), total: 150 * GB },
      expire: "2027-04-02",
    });
  });

  it("奶昔形态:Traffic Reset 倒计时不被当成流量,Expire Date 斜杠日期", () => {
    expect(extractInfoNodeQuota(["Traffic Reset：4 Days Left", "Expire Date：2027/06/18"], FETCHED)).toEqual({
      reset_at: new Date(2026, 9, 13).getTime(),
      expire: "2027-06-18",
    });
  });

  it("中文形态:剩余流量换算成已用、套餐到期年月日、距离下次重置剩余 N 天", () => {
    const q = extractInfoNodeQuota(
      ["🚀 剩余流量：76.07 GB | 150 GB", "套餐到期：2027年4月2日", "距离下次重置剩余：25 天"],
      FETCHED,
    );
    expect(q?.traffic).toEqual({ used: 150 * GB - Math.round(76.07 * GB), total: 150 * GB });
    expect(q?.expire).toBe("2027-04-02");
    expect(q?.reset_at).toBe(new Date(2026, 10, 3).getTime());
  });

  it("纯用量行与 TB 单位", () => {
    expect(extractInfoNodeQuota(["0.5 TB / 1 TB"], FETCHED)?.traffic).toEqual({ used: 0.5 * 1024 * GB, total: 1024 * GB });
  });

  it("下次重置给的是日期", () => {
    expect(extractInfoNodeQuota(["下次重置：2026-11-02"], FETCHED)?.reset_at).toBe(new Date(2026, 10, 2).getTime());
  });

  it("认不出含义的信息节点不给值:公告 / 官网 / 非法日期", () => {
    expect(extractInfoNodeQuota(["📢 公告:本周维护", "官网│https://example.com", "Expire: 2027-02-30"], FETCHED)).toBeUndefined();
  });

  it("多条同类信息取第一条", () => {
    expect(extractInfoNodeQuota(["Expire: 2027-04-02", "到期时间: 2028-01-01"], FETCHED)?.expire).toBe("2027-04-02");
  });

  it("测试用的名字确实都会被 info-node-filter 判为信息节点(两边口径一致)", () => {
    for (const name of [
      "Traffic: 73.93 GB | 150 GB",
      "Expire: 2027-04-02",
      "Traffic Reset：4 Days Left",
      "Expire Date：2027/06/18",
      "🚀 剩余流量：76.07 GB | 150 GB",
      "套餐到期：2027年4月2日",
      "距离下次重置剩余：25 天",
      "下次重置：2026-11-02",
    ]) {
      expect(isInfoNode({ name }), name).toBe(true);
    }
  });
});
