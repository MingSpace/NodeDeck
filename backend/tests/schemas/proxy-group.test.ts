import { describe, expect, it } from "vitest";
import { proxyGroupSchema } from "../../src/schemas/proxy-group.js";

/**
 * 验证 proxy-group schema 在 parse 阶段把旧字段 selector.include_other_group
 * 透明搬到顶层 nested_groups,并清空老字段;新 yaml 直通不变。
 *
 * 这是 v1→v2 的隐式迁移层,首次 save 后老 yaml 会被改写成新字段形态(因为
 * Repo.save 先 parse 再 writeYaml,parse 输出已是迁移结果)。
 */
describe("proxyGroupSchema transform — 嵌套组字段迁移", () => {
  it("把老 selector.include_other_group 搬到 nested_groups 并清空老字段", () => {
    const raw = {
      id: "Stream",
      name: "Stream",
      type: "select",
      proxies: [],
      selector: {
        include_regex: "",
        exclude_regex: "",
        include_other_group: ["Japan", "HK"],
        from_providers: ["airport-a"],
        exclude_type: [],
        include_region: [],
      },
    };
    const parsed = proxyGroupSchema.parse(raw);
    expect(parsed.nested_groups).toEqual(["Japan", "HK"]);
    expect(parsed.selector?.include_other_group).toEqual([]);
    expect(parsed.selector?.from_providers).toEqual(["airport-a"]);
  });

  it("新 yaml(已有 nested_groups, selector 无 include_other_group)直通", () => {
    const raw = {
      id: "Stream",
      name: "Stream",
      type: "select",
      proxies: [],
      nested_groups: ["Japan"],
    };
    const parsed = proxyGroupSchema.parse(raw);
    expect(parsed.nested_groups).toEqual(["Japan"]);
    expect(parsed.selector).toBeUndefined();
  });

  it("nested_groups 与老 selector 同时存在时去重合并(新值在前)", () => {
    const raw = {
      id: "Stream",
      name: "Stream",
      type: "select",
      nested_groups: ["Japan"],
      selector: { include_other_group: ["HK", "Japan"], from_providers: [] },
    };
    const parsed = proxyGroupSchema.parse(raw);
    expect(parsed.nested_groups).toEqual(["Japan", "HK"]);
    expect(parsed.selector?.include_other_group).toEqual([]);
  });

  it("空 selector.include_other_group 不触发迁移(避免无意义改写)", () => {
    const raw = {
      id: "G",
      name: "G",
      type: "select",
      selector: { include_other_group: [], from_providers: ["a"] },
    };
    const parsed = proxyGroupSchema.parse(raw);
    expect(parsed.nested_groups).toEqual([]);
    expect(parsed.selector?.from_providers).toEqual(["a"]);
  });

  it("根本没有 selector 字段时不报错,nested_groups 缺省为 []", () => {
    const raw = { id: "G", name: "G", type: "select", proxies: ["DIRECT"] };
    const parsed = proxyGroupSchema.parse(raw);
    expect(parsed.nested_groups).toEqual([]);
    expect(parsed.proxies).toEqual(["DIRECT"]);
  });

  it("顶层 include_other_group: string(Surge 原生平铺参数)与 nested_groups 共存", () => {
    // 这俩字段语义不同:顶层 string 是 Surge include-other-group 参数(平铺成员),
    // nested_groups 是嵌套引用(单个 proxy 项)。共存合法。
    const raw = {
      id: "G",
      name: "G",
      type: "select",
      include_other_group: "FlatGroup",
      nested_groups: ["NestedGroup"],
    };
    const parsed = proxyGroupSchema.parse(raw);
    expect(parsed.include_other_group).toBe("FlatGroup");
    expect(parsed.nested_groups).toEqual(["NestedGroup"]);
  });
});
