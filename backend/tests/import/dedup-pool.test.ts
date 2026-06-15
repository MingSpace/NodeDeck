import { describe, expect, it } from "vitest";
import {
  dedupAgainstPool,
  dedupBy,
  rulesetIdentity,
  proxyGroupIdentity,
  surgeModuleIdentity,
  generalPresetIdentity,
} from "../../src/import/dedup-pool.js";
import type { Node } from "../../src/schemas/node.js";
import type { RuleSet } from "../../src/schemas/ruleset.js";
import type { ProxyGroup } from "../../src/schemas/proxy-group.js";
import type { SurgeModule } from "../../src/schemas/surge-module.js";
import type { GeneralPreset } from "../../src/schemas/general-preset.js";

function ss(name: string, server: string, port: number, password: string): Node {
  return {
    name,
    type: "ss",
    server,
    port,
    cipher: "aes-128-gcm",
    password,
  } as Node;
}

function trojan(name: string, server: string, port: number, password: string): Node {
  return {
    name,
    type: "trojan",
    server,
    port,
    password,
  } as Node;
}

describe("dedupAgainstPool", () => {
  it("skips imported nodes that match an existing pool entry by (type|server|port|secret)", () => {
    const pool: Node[] = [ss("Pool-A", "s.com", 8388, "pwd")];
    const toImport: Node[] = [
      ss("Imported-A", "s.com", 8388, "pwd"), // identity == Pool-A → 跳过
      ss("Imported-B", "s.com", 8388, "different-pwd"), // 不同密钥 → 保留
    ];

    const { kept, duplicates } = dedupAgainstPool(toImport, pool);
    expect(kept.map((n) => n.name)).toEqual(["Imported-B"]);
    expect(duplicates.map((n) => n.name)).toEqual(["Imported-A"]);
  });

  it("dedupes within the imported batch itself (keep first)", () => {
    const pool: Node[] = [];
    const toImport: Node[] = [
      trojan("Trojan-1", "t.com", 443, "secret"),
      trojan("Trojan-1-dup", "t.com", 443, "secret"), // 同一节点不同名 → 文件内重复
    ];

    const { kept, duplicates } = dedupAgainstPool(toImport, pool);
    expect(kept.map((n) => n.name)).toEqual(["Trojan-1"]);
    expect(duplicates.map((n) => n.name)).toEqual(["Trojan-1-dup"]);
  });

  it("treats different protocols on same server:port as distinct", () => {
    // 同 server:port 但 type 不同(罕见但允许),identity 不同
    const pool: Node[] = [ss("Pool-SS", "x.com", 443, "k")];
    const toImport: Node[] = [trojan("Imp-Trojan", "x.com", 443, "k")];
    const { kept, duplicates } = dedupAgainstPool(toImport, pool);
    expect(kept).toHaveLength(1);
    expect(duplicates).toHaveLength(0);
  });

  it("returns all kept when pool is empty", () => {
    const toImport: Node[] = [
      ss("A", "s.com", 8388, "pwd"),
      trojan("B", "t.com", 443, "secret"),
    ];
    const { kept, duplicates } = dedupAgainstPool(toImport, []);
    expect(kept).toHaveLength(2);
    expect(duplicates).toHaveLength(0);
  });
});

describe("entity identities", () => {
  it("rulesetIdentity ignores name/id but discriminates by url + behavior + policy", () => {
    const a: Partial<RuleSet> = {
      id: "imported-rule-1",
      name: "cn",
      type: "remote_url",
      url: "https://x/cn.list",
      behavior: "classical",
      format: "text",
      policy: "DIRECT",
    };
    const sameContentDifferentName: Partial<RuleSet> = { ...a, id: "imported-rule-99", name: "cn-2" };
    const differentPolicy: Partial<RuleSet> = { ...a, policy: "REJECT" };
    const differentUrl: Partial<RuleSet> = { ...a, url: "https://x/cn-v2.list" };

    expect(rulesetIdentity(a)).toBe(rulesetIdentity(sameContentDifferentName));
    expect(rulesetIdentity(a)).not.toBe(rulesetIdentity(differentPolicy));
    expect(rulesetIdentity(a)).not.toBe(rulesetIdentity(differentUrl));
  });

  it("rulesetIdentity discriminates surge_internal name (SYSTEM vs LAN)", () => {
    const sys: Partial<RuleSet> = {
      id: "imported-rule-system-abc",
      name: "SYSTEM",
      type: "surge_internal",
      surge_internal_name: "SYSTEM",
      behavior: "classical",
      format: "text",
      policy: "DIRECT",
    };
    const lan: Partial<RuleSet> = { ...sys, name: "LAN", surge_internal_name: "LAN" };
    const sysDup: Partial<RuleSet> = { ...sys, id: "imported-rule-system-xyz" };
    expect(rulesetIdentity(sys)).not.toBe(rulesetIdentity(lan));
    expect(rulesetIdentity(sys)).toBe(rulesetIdentity(sysDup));
  });

  it("proxyGroupIdentity is order-independent across members and ignores test params", () => {
    const a: Partial<ProxyGroup> = {
      id: "imported-auto",
      name: "Auto",
      type: "url-test",
      proxies: ["HK-01", "JP-01", "SG-01"],
      url: "http://cp.cloudflare.com/generate_204",
      interval: 600,
    };
    const sameMembersReordered: Partial<ProxyGroup> = { ...a, proxies: ["SG-01", "HK-01", "JP-01"] };
    const differentMembers: Partial<ProxyGroup> = { ...a, proxies: ["HK-01", "JP-01"] };
    const differentName: Partial<ProxyGroup> = { ...a, name: "Manual" };

    expect(proxyGroupIdentity(a)).toBe(proxyGroupIdentity(sameMembersReordered));
    expect(proxyGroupIdentity(a)).not.toBe(proxyGroupIdentity(differentMembers));
    expect(proxyGroupIdentity(a)).not.toBe(proxyGroupIdentity(differentName));
  });

  it("surgeModuleIdentity hashes content sections, not id", () => {
    const a: Partial<SurgeModule> = {
      id: "imported-module",
      name: "Imported",
      content_sections: { url_rewrite: "^https://x .* 302" },
    };
    const sameContent: Partial<SurgeModule> = { ...a, id: "imported-module-99" };
    const editedContent: Partial<SurgeModule> = {
      ...a,
      content_sections: { url_rewrite: "^https://y .* 302" },
    };
    expect(surgeModuleIdentity(a)).toBe(surgeModuleIdentity(sameContent));
    expect(surgeModuleIdentity(a)).not.toBe(surgeModuleIdentity(editedContent));
  });

  it("generalPresetIdentity ignores id and name", () => {
    const a: Partial<GeneralPreset> = {
      id: "imported",
      name: "Imported from a.conf",
      mode: "rule",
      log_level: "notify",
      ipv6: false,
      allow_lan: false,
    };
    const renamed: Partial<GeneralPreset> = { ...a, id: "imported-x", name: "Imported from b.conf" };
    const flippedFlag: Partial<GeneralPreset> = { ...a, ipv6: true };
    expect(generalPresetIdentity(a)).toBe(generalPresetIdentity(renamed));
    expect(generalPresetIdentity(a)).not.toBe(generalPresetIdentity(flippedFlag));
  });

  it("dedupBy uses the supplied identity", () => {
    type Item = { id: string; key: string };
    const pool: Item[] = [{ id: "a", key: "alpha" }];
    const incoming: Item[] = [
      { id: "b", key: "alpha" }, // dup
      { id: "c", key: "beta" }, // kept
      { id: "d", key: "beta" }, // dup with previous incoming
    ];
    const { kept, duplicates } = dedupBy(incoming, pool, (x) => x.key);
    expect(kept.map((k) => k.id)).toEqual(["c"]);
    expect(duplicates.map((d) => d.id)).toEqual(["b", "d"]);
  });
});
