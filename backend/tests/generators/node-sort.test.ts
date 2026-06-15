import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { sortNodesByRegion } from "../../src/generators/node-sort.js";
import { generateClashConfig } from "../../src/generators/clash.js";
import type { Node } from "../../src/schemas/node.js";
import type { Profile } from "../../src/schemas/profile.js";
import type { ProxyGroup } from "../../src/schemas/proxy-group.js";

function ssNode(name: string, region?: string): Node {
  return {
    name,
    type: "ss",
    server: `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}.example.com`,
    port: 8388,
    cipher: "aes-128-gcm",
    password: "pwd",
    region,
    tags: [],
  } as Node;
}

describe("sortNodesByRegion", () => {
  it("固定优先级:HK → TW → JP → SG → US", () => {
    const nodes = [
      ssNode("US-01", "US"),
      ssNode("JP-01", "JP"),
      ssNode("HK-01", "HK"),
      ssNode("SG-01", "SG"),
      ssNode("TW-01", "TW"),
    ];
    const sorted = sortNodesByRegion(nodes);
    expect(sorted.map((n) => n.name)).toEqual(["HK-01", "TW-01", "JP-01", "SG-01", "US-01"]);
  });

  it("其他已识别地区按 region 代码字母序排在优先级地区之后", () => {
    const nodes = [
      ssNode("UK-01", "GB"),
      ssNode("KR-01", "KR"),
      ssNode("DE-01", "DE"),
      ssNode("HK-01", "HK"),
      ssNode("US-01", "US"),
    ];
    const sorted = sortNodesByRegion(nodes);
    // DE < GB < KR 字母序
    expect(sorted.map((n) => n.name)).toEqual(["HK-01", "US-01", "DE-01", "UK-01", "KR-01"]);
  });

  it("region 未识别的节点垫底", () => {
    const nodes = [
      ssNode("Mystery-01"),
      ssNode("HK-01", "HK"),
      ssNode("Mystery-02"),
      ssNode("KR-01", "KR"),
    ];
    const sorted = sortNodesByRegion(nodes);
    expect(sorted.map((n) => n.name)).toEqual(["HK-01", "KR-01", "Mystery-01", "Mystery-02"]);
  });

  it("稳定排序:同地区内保持原始顺序(中英文混排聚到一起)", () => {
    const nodes = [
      ssNode("日本高级 IEPL 专线 1", "JP"),
      ssNode("香港高级 IEPL 专线 1", "HK"),
      ssNode("日本高级 IEPL 专线 2", "JP"),
      ssNode("Hong Kong Premium", "HK"),
      ssNode("香港高级 IEPL 专线 2", "HK"),
    ];
    const sorted = sortNodesByRegion(nodes);
    expect(sorted.map((n) => n.name)).toEqual([
      "香港高级 IEPL 专线 1",
      "Hong Kong Premium",
      "香港高级 IEPL 专线 2",
      "日本高级 IEPL 专线 1",
      "日本高级 IEPL 专线 2",
    ]);
  });

  it("不修改原数组", () => {
    const nodes = [ssNode("US-01", "US"), ssNode("HK-01", "HK")];
    sortNodesByRegion(nodes);
    expect(nodes.map((n) => n.name)).toEqual(["US-01", "HK-01"]);
  });
});

describe("generateClashConfig with sort_by_region", () => {
  function baseProfile(overrides: Partial<Profile> = {}): Profile {
    return {
      id: "home",
      name: "Home",
      token: "abcdefghij12",
      providers: [],
      node_filter: { rename_rules: [], exclude_types: [], sort_by_region: true },
      chain_rules: [],
      proxy_groups: [],
      rule_modules: [],
      surge_modules: [],
      userinfo: { enabled: false, mode: "sum", expose_per_provider_headers: true },
      managed_config_url: "auto",
      managed_config_interval: 86400,
      managed_config_strict: false,
      clash_options: { use_proxy_providers: false, flag: "mihomo", group_style: "flow" },
      ...overrides,
    };
  }

  it("proxies 段与 selector 组成员都按地区聚类", () => {
    const nodes = [
      ssNode("US-01", "US"),
      ssNode("Hong Kong 1", "HK"),
      ssNode("日本 1", "JP"),
      ssNode("香港 1", "HK"),
      ssNode("Unknown-01"),
    ];
    const groups: ProxyGroup[] = [
      {
        id: "Proxys",
        name: "Proxys",
        type: "select",
        proxies: [],
        nested_groups: [],
        selector: { from_providers: [], exclude_type: [], include_region: [] },
      },
    ];
    const out = generateClashConfig({
      profile: baseProfile({ proxy_groups: ["Proxys"] }),
      nodes,
      groups,
      rules: [],
      finalRule: { policy: "Proxys" },
      warnings: [],
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    const proxies = (parsed.proxies as Array<{ name: string }>).map((p) => p.name);
    expect(proxies).toEqual(["Hong Kong 1", "香港 1", "日本 1", "US-01", "Unknown-01"]);
    const proxyGroups = parsed["proxy-groups"] as Array<Record<string, unknown>>;
    const members = proxyGroups.find((g) => g.name === "Proxys")!.proxies as string[];
    expect(members).toEqual(["Hong Kong 1", "香港 1", "日本 1", "US-01", "Unknown-01"]);
  });

  it("sort_by_region=false 时保持原始顺序", () => {
    const nodes = [ssNode("US-01", "US"), ssNode("香港 1", "HK")];
    const out = generateClashConfig({
      profile: baseProfile({
        node_filter: { rename_rules: [], exclude_types: [], sort_by_region: false },
      }),
      nodes,
      groups: [],
      rules: [],
      finalRule: { policy: "DIRECT" },
      warnings: [],
    });
    const parsed = yaml.load(out) as Record<string, unknown>;
    const proxies = (parsed.proxies as Array<{ name: string }>).map((p) => p.name);
    expect(proxies).toEqual(["US-01", "香港 1"]);
  });
});
