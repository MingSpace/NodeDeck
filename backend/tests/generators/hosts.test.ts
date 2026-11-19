import { describe, expect, it } from "vitest";
import {
  normalizeHostValue,
  buildSurgeHostLines,
  mergeHostMaps,
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

describe("buildSurgeHostLines", () => {
  it("emits `key = value` for single values", () => {
    expect(buildSurgeHostLines({ "a.com": "1.2.3.4" })).toEqual(["a.com = 1.2.3.4"]);
  });

  it("keeps CNAME alias", () => {
    expect(buildSurgeHostLines({ "baidu.com": "google.com" })).toEqual(["baidu.com = google.com"]);
  });

  // [Host] 条目自上而下求值、首条命中即止(manual.nssurge.com/dns/local-dns-mapping.html),
  // 所以同 key 多值必须合并成一行的逗号列表,拆多行会让第二行起永远不生效。
  it("merges multi upstream DNS into one line with a single server: prefix", () => {
    expect(
      buildSurgeHostLines({
        "*.example.com": [
          "server:https://a.com/dns-query",
          "server:https://b.com/dns-query",
        ],
      }),
    ).toEqual(["*.example.com = server:https://a.com/dns-query,https://b.com/dns-query"]);
  });

  it("merges comma-separated IP values into one line", () => {
    expect(buildSurgeHostLines({ "b.com": "1.1.1.1, 2.2.2.2" })).toEqual([
      "b.com = 1.1.1.1, 2.2.2.2",
    ]);
  });

  it("server: 与 IP 混用时保留 server: 并对丢弃的值 warning", () => {
    // 一个 [Host] 条目只能是一种映射;合并 general + provider hosts 时容易混进来,
    // 静默丢 IP 映射很难排查,所以必须出 warning。
    const warnings: string[] = [];
    const lines = buildSurgeHostLines({ "c.com": ["1.2.3.4", "server:8.8.8.8"] }, warnings);
    expect(lines).toEqual(["c.com = server:8.8.8.8"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("c.com");
    expect(warnings[0]).toContain("1.2.3.4");
  });

  it("纯 IP 多值不触发 warning", () => {
    const warnings: string[] = [];
    buildSurgeHostLines({ "d.com": ["1.2.3.4", "5.6.7.8"] }, warnings);
    expect(warnings).toEqual([]);
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
