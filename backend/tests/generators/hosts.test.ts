import { describe, expect, it } from "vitest";
import {
  normalizeHostValue,
  isSurgeOnlyHostEntry,
  buildClashHosts,
  buildSurgeHostLines,
  mergeHostMaps,
  splitClashHosts,
} from "../../src/generators/hosts.js";

describe("normalizeHostValue", () => {
  it("splits comma-separated string and trims", () => {
    expect(normalizeHostValue("1.1.1.1, 2.2.2.2")).toEqual(["1.1.1.1", "2.2.2.2"]);
  });

  it("keeps array, trims items and drops empties", () => {
    expect(normalizeHostValue([" a ", "", "b "])).toEqual(["a", "b"]);
  });

  it("returns single-element array for a plain value", () => {
    expect(normalizeHostValue("1.2.3.4")).toEqual(["1.2.3.4"]);
  });
});

describe("isSurgeOnlyHostEntry", () => {
  it("detects server: value (including system/syslib)", () => {
    expect(isSurgeOnlyHostEntry("bar.com", ["server:8.8.8.8"])).toBe(true);
    expect(isSurgeOnlyHostEntry("mac.lan", ["server:system"])).toBe(true);
  });

  it("detects DOMAIN-SET: / RULE-SET: key (case-insensitive)", () => {
    expect(isSurgeOnlyHostEntry("DOMAIN-SET:https://x/d.txt", ["10.0.0.1"])).toBe(true);
    expect(isSurgeOnlyHostEntry("rule-set:https://x/r.txt", ["10.0.0.1"])).toBe(true);
  });

  it("treats plain IP and CNAME alias as cross-platform", () => {
    expect(isSurgeOnlyHostEntry("a.com", ["1.2.3.4"])).toBe(false);
    expect(isSurgeOnlyHostEntry("baidu.com", ["google.com"])).toBe(false);
  });
});

describe("buildClashHosts", () => {
  it("emits string for single IP and array for multiple IPs", () => {
    const warnings: string[] = [];
    const out = buildClashHosts({ "a.com": "1.2.3.4", "b.com": "1.1.1.1, 2.2.2.2" }, warnings);
    expect(out).toEqual({ "a.com": "1.2.3.4", "b.com": ["1.1.1.1", "2.2.2.2"] });
    expect(warnings).toHaveLength(0);
  });

  it("preserves array values", () => {
    const out = buildClashHosts({ "a.com": ["1.1.1.1", "2.2.2.2"] }, []);
    expect(out["a.com"]).toEqual(["1.1.1.1", "2.2.2.2"]);
  });

  it("keeps single CNAME alias", () => {
    const out = buildClashHosts({ "baidu.com": "google.com" }, []);
    expect(out["baidu.com"]).toBe("google.com");
  });

  it("skips Surge-only entries with warnings", () => {
    const warnings: string[] = [];
    const out = buildClashHosts(
      {
        "bar.com": "server:8.8.8.8",
        "DOMAIN-SET:https://x/d.txt": "server:1.1.1.1",
        "ok.com": "1.2.3.4",
      },
      warnings,
    );
    expect(out).toEqual({ "ok.com": "1.2.3.4" });
    expect(warnings).toHaveLength(2);
    expect(warnings.some((w) => w.includes("bar.com"))).toBe(true);
    expect(warnings.some((w) => w.includes("DOMAIN-SET"))).toBe(true);
  });

  it("drops empty values", () => {
    const out = buildClashHosts({ "a.com": "", "b.com": " , " }, []);
    expect(out).toEqual({});
  });
});

describe("buildSurgeHostLines", () => {
  it("emits `key = value` for single values", () => {
    expect(buildSurgeHostLines({ "a.com": "1.2.3.4" })).toEqual(["a.com = 1.2.3.4"]);
  });

  it("keeps CNAME alias", () => {
    expect(buildSurgeHostLines({ "baidu.com": "google.com" })).toEqual(["baidu.com = google.com"]);
  });

  it("expands multi-value array into multiple lines (multi upstream DNS)", () => {
    expect(
      buildSurgeHostLines({
        "*.ovalyraa.com": [
          "server:https://a.com/dns-query",
          "server:https://b.com/dns-query",
        ],
      }),
    ).toEqual([
      "*.ovalyraa.com = server:https://a.com/dns-query",
      "*.ovalyraa.com = server:https://b.com/dns-query",
    ]);
  });

  it("expands comma-separated string values too", () => {
    expect(buildSurgeHostLines({ "b.com": "1.1.1.1, 2.2.2.2" })).toEqual([
      "b.com = 1.1.1.1",
      "b.com = 2.2.2.2",
    ]);
  });

  it("emits Surge-only syntax verbatim", () => {
    expect(
      buildSurgeHostLines({
        "bar.com": "server:8.8.8.8",
        "DOMAIN-SET:https://x/d.txt": "server:1.1.1.1",
      }),
    ).toEqual([
      "bar.com = server:8.8.8.8",
      "DOMAIN-SET:https://x/d.txt = server:1.1.1.1",
    ]);
  });
});

describe("mergeHostMaps", () => {
  it("merges general + provider maps and dedupes identical key+value", () => {
    const out = mergeHostMaps({ "a.com": "1.1.1.1" }, { "a.com": "1.1.1.1", "b.com": "2.2.2.2" });
    expect(out).toEqual({ "a.com": ["1.1.1.1"], "b.com": ["2.2.2.2"] });
  });

  it("accumulates distinct values for the same key into one array", () => {
    const out = mergeHostMaps(
      { "*.x.com": "server:https://a/dns" },
      { "*.x.com": ["server:https://b/dns", "server:https://a/dns"] },
    );
    expect(out).toEqual({ "*.x.com": ["server:https://a/dns", "server:https://b/dns"] });
  });

  it("skips undefined/null maps and empty values", () => {
    expect(mergeHostMaps(undefined, { "a.com": "" }, null)).toEqual({});
  });
});

describe("splitClashHosts", () => {
  it("routes server: entries to serverPolicy with *. -> +. and strips the prefix", () => {
    const { staticHosts, serverPolicy } = splitClashHosts(
      {
        "*.ovalyraa.com": [
          "server:https://hydrogen1693.com:44443/dns-query/abc",
          "server:https://subprime7404.com:44443/dns-query/abc",
        ],
      },
      [],
    );
    expect(staticHosts).toEqual({});
    expect(serverPolicy).toEqual({
      "+.ovalyraa.com": [
        "https://hydrogen1693.com:44443/dns-query/abc",
        "https://subprime7404.com:44443/dns-query/abc",
      ],
    });
  });

  it("keeps bare-domain key as-is and maps server:system", () => {
    const { serverPolicy } = splitClashHosts({ "node.example.com": "server:system" }, []);
    expect(serverPolicy).toEqual({ "node.example.com": ["system"] });
  });

  it("drops server:syslib with a warning", () => {
    const warnings: string[] = [];
    const { serverPolicy } = splitClashHosts({ "*.x.com": "server:syslib" }, warnings);
    expect(serverPolicy).toEqual({});
    expect(warnings.some((w) => w.includes("syslib"))).toBe(true);
  });

  it("routes plain IP / CNAME to staticHosts (single string, multi array, alias)", () => {
    const { staticHosts, serverPolicy } = splitClashHosts(
      { "a.com": "1.2.3.4", "b.com": ["1.1.1.1", "2.2.2.2"], "baidu.com": "google.com" },
      [],
    );
    expect(serverPolicy).toEqual({});
    expect(staticHosts).toEqual({
      "a.com": "1.2.3.4",
      "b.com": ["1.1.1.1", "2.2.2.2"],
      "baidu.com": "google.com",
    });
  });

  it("skips DOMAIN-SET: / RULE-SET: keys with warnings (neither static nor policy)", () => {
    const warnings: string[] = [];
    const { staticHosts, serverPolicy } = splitClashHosts(
      { "DOMAIN-SET:https://x/d.txt": "server:1.1.1.1", "RULE-SET:https://x/r.txt": "10.0.0.1" },
      warnings,
    );
    expect(staticHosts).toEqual({});
    expect(serverPolicy).toEqual({});
    expect(warnings.length).toBeGreaterThanOrEqual(2);
  });

  it("ignores a non-server value mixed with server: and warns", () => {
    const warnings: string[] = [];
    const { serverPolicy } = splitClashHosts(
      { "*.x.com": ["server:https://doh/dns-query", "1.2.3.4"] },
      warnings,
    );
    expect(serverPolicy).toEqual({ "+.x.com": ["https://doh/dns-query"] });
    expect(warnings.some((w) => w.includes("混用"))).toBe(true);
  });
});
