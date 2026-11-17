import { describe, expect, it } from "vitest";
import { classifyIp, describeUserAgent } from "../../src/stats/user-agent.js";

describe("describeUserAgent", () => {
  it("Surge Mac:build 号 + SurgeCore", () => {
    expect(describeUserAgent("Surge Mac/12800 SurgeCore/6011000")).toEqual({
      version: "12800",
      components: ["SurgeCore 6011000"],
    });
  });

  it("没有版本号的 UA 只给空细节", () => {
    expect(describeUserAgent("Surge")).toEqual({ components: [] });
    // 客户端名里的 iOS 不重复当成系统
    expect(describeUserAgent("Surge iOS/3456 SurgeCore/6011000").os).toBeUndefined();
    expect(describeUserAgent(undefined)).toEqual({ components: [] });
  });

  it("Android 系统栈 UA 带出系统版本和机型,Dalvik 不当成版本", () => {
    expect(describeUserAgent("Dalvik/2.1.0 (Linux; U; Android 14; Pixel 8 Build/AP2A.240805.005)")).toEqual({
      components: [],
      os: "Android 14",
      device: "Pixel 8",
    });
  });

  it("客户端自带 Android 括号段", () => {
    const d = describeUserAgent("ClashMetaForAndroid/2.11.5.Meta (Linux; Android 15; 23127PN0CC Build/AQ3A.240627.003)");
    expect(d).toMatchObject({ version: "2.11.5.Meta", os: "Android 15", device: "23127PN0CC" });
  });

  it("iPhone / iPad 的系统版本", () => {
    expect(describeUserAgent("App/1.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X)")).toMatchObject({
      os: "iOS 18.2",
      device: "iPhone",
    });
    expect(describeUserAgent("App/1.0 (iPad; CPU OS 17_5 like Mac OS X)")).toMatchObject({
      os: "iPadOS 17.5",
      device: "iPad",
    });
  });

  it("桌面端:内核版本作为组件,平台从产品段兜底", () => {
    expect(describeUserAgent("clash-verge/v2.2.3 mihomo/v1.19.2")).toEqual({
      version: "v2.2.3",
      components: ["mihomo v1.19.2"],
    });
    expect(describeUserAgent("FlClash/v0.8.80 Platform/android")).toMatchObject({ os: "Android" });
    expect(describeUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0")).toMatchObject({ os: "Windows" });
  });
});

describe("classifyIp", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["::1", "loopback"],
    ["::ffff:127.0.0.1", "loopback"],
    ["172.18.0.1", "private"],
    ["192.168.1.5", "private"],
    ["10.0.0.2", "private"],
    ["100.101.102.103", "private"],
    ["fd7a:115c:a1e0::1", "private"],
    ["114.92.176.45", "public"],
    ["2400:cb00::1", "public"],
    ["unknown", "unknown"],
  ])("%s → %s", (ip, scope) => {
    expect(classifyIp(ip)).toBe(scope);
  });
});
