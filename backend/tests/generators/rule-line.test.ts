import { describe, it, expect } from "vitest";
import {
  parseInlineRuleLine,
  flagAppliesToRuleType,
  buildExpandedRuleLine,
} from "../../src/generators/rule-line.js";

describe("parseInlineRuleLine", () => {
  it("keeps TYPE,VALUE intact when the line carries no option", () => {
    expect(parseInlineRuleLine("IP-CIDR,10.0.0.0/24")).toEqual({
      type: "IP-CIDR",
      head: "IP-CIDR,10.0.0.0/24",
      options: [],
    });
  });

  it("splits trailing per-line options off the value", () => {
    expect(parseInlineRuleLine("IP-CIDR,203.0.113.0/24,no-resolve")).toEqual({
      type: "IP-CIDR",
      head: "IP-CIDR,203.0.113.0/24",
      options: ["no-resolve"],
    });
    expect(parseInlineRuleLine("DOMAIN,cdn.example.org,extended-matching")).toEqual({
      type: "DOMAIN",
      head: "DOMAIN,cdn.example.org",
      options: ["extended-matching"],
    });
    expect(parseInlineRuleLine("RULE-SET,LAN,no-resolve,update-interval=43200").options).toEqual([
      "no-resolve",
      "update-interval=43200",
    ]);
  });

  it("does not mistake a value for an option", () => {
    // 逻辑规则:括号内含逗号,尾段不是已知 option,必须原样保留
    const logical = parseInlineRuleLine("AND,((DOMAIN,baidu.com),(NETWORK,UDP))");
    expect(logical.type).toBe("AND");
    expect(logical.head).toBe("AND,((DOMAIN,baidu.com),(NETWORK,UDP))");
    expect(logical.options).toEqual([]);
    // 未知的 key=value 不剥离,避免把带等号的值吃掉
    expect(parseInlineRuleLine("URL-REGEX,^https://a.com/\\?x=1").options).toEqual([]);
  });
});

describe("flagAppliesToRuleType", () => {
  it("limits no-resolve to destination-IP rules", () => {
    for (const t of ["IP-CIDR", "IP-CIDR6", "IP-SUFFIX", "IP-ASN", "GEOIP"]) {
      expect(flagAppliesToRuleType("no-resolve", t)).toBe(true);
    }
    for (const t of ["DOMAIN", "DOMAIN-SUFFIX", "PROCESS-NAME", "SRC-IP-CIDR"]) {
      expect(flagAppliesToRuleType("no-resolve", t)).toBe(false);
    }
  });

  it("limits extended-matching to domain rules", () => {
    expect(flagAppliesToRuleType("extended-matching", "DOMAIN-SUFFIX")).toBe(true);
    expect(flagAppliesToRuleType("extended-matching", "IP-CIDR")).toBe(false);
  });

  it("passes through flags whose scope we do not model", () => {
    expect(flagAppliesToRuleType("pre-matching", "IP-CIDR")).toBe(true);
    expect(flagAppliesToRuleType("force-remote-dns", "DOMAIN")).toBe(true);
  });
});

describe("buildExpandedRuleLine", () => {
  it("puts the policy before the options, not after", () => {
    expect(
      buildExpandedRuleLine({ item: "IP-CIDR,10.0.0.0/8,no-resolve", policy: "DIRECT" }),
    ).toBe("IP-CIDR,10.0.0.0/8,DIRECT,no-resolve");
  });

  it("distributes ruleset-level flags per line type", () => {
    const flags = ["no-resolve", "extended-matching"];
    expect(buildExpandedRuleLine({ item: "DOMAIN,nas.example.com", policy: "P", flags })).toBe(
      "DOMAIN,nas.example.com,P,extended-matching",
    );
    expect(buildExpandedRuleLine({ item: "IP-CIDR,10.0.0.0/24", policy: "P", flags })).toBe(
      "IP-CIDR,10.0.0.0/24,P,no-resolve",
    );
    // 两者都不适用的类型:一个都不挂
    expect(buildExpandedRuleLine({ item: "PROCESS-NAME,Telegram", policy: "P", flags })).toBe(
      "PROCESS-NAME,Telegram,P",
    );
  });

  it("does not duplicate an option the line already carries", () => {
    expect(
      buildExpandedRuleLine({
        item: "IP-CIDR,10.0.0.0/24,no-resolve",
        policy: "P",
        flags: ["no-resolve"],
      }),
    ).toBe("IP-CIDR,10.0.0.0/24,P,no-resolve");
  });

  it("keeps extraParams between the policy and the options", () => {
    expect(
      buildExpandedRuleLine({
        item: "IP-CIDR,10.0.0.0/24",
        policy: "REJECT-DROP",
        extraParams: [`'notification-text="blocked"'`],
        flags: ["no-resolve"],
      }),
    ).toBe(`IP-CIDR,10.0.0.0/24,REJECT-DROP,'notification-text="blocked"',no-resolve`);
  });
});
