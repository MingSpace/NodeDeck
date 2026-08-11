import { describe, expect, it } from "vitest";
import { generalPresetSchema } from "../../src/schemas/general-preset.js";

/**
 * Surge 的 `http-api = key@ip:port` 里 key 是一整串不可切分的密钥,没有用户名概念,
 * 所以 http_api.user 已被移除。存量 yaml 可能还带着早期版本按 `:` 拆出来的 user;
 * 直接丢掉会让写回的 key 变短,Surge 侧 X-Key 失配,因此 parse 时折回 password 前缀。
 */
describe("generalPresetSchema — http_api.user 迁移", () => {
  const base = { id: "g", name: "g" };

  it("把老 http_api.user 折回 password 前缀并清空老字段", () => {
    const parsed = generalPresetSchema.parse({
      ...base,
      http_api: { user: "admin", password: "pw", listen: "0.0.0.0:8890" },
    });
    expect(parsed.http_api).toEqual({
      password: "admin:pw",
      listen: "0.0.0.0:8890",
      web_dashboard: false,
      tls: false,
    });
    expect(parsed.http_api).not.toHaveProperty("user");
  });

  it("空 user 与无 user 都直通不变", () => {
    for (const http_api of [
      { password: "pw", listen: "0.0.0.0:8890" },
      { user: "", password: "pw", listen: "0.0.0.0:8890" },
    ]) {
      expect(generalPresetSchema.parse({ ...base, http_api }).http_api).toMatchObject({ password: "pw" });
    }
  });

  it("password 为空仍然拒绝", () => {
    expect(() => generalPresetSchema.parse({ ...base, http_api: { password: "" } })).toThrow();
  });
});

/**
 * Surge 的 include-local-networks / include-apns / include-cellular-services 只有在
 * include-all-networks=true 时才生效,单开会被**静默忽略**。生成一份看着有效实际无效的
 * conf 极难排查(用户以为开了 APNs 接管而推送依旧不来),所以在 schema 层就拦住。
 */
describe("generalPresetSchema — VPN Tunnel Scope 依赖", () => {
  const base = { id: "g", name: "g" };

  it("接受配合 include_all_networks 的子开关", () => {
    const parsed = generalPresetSchema.parse({
      ...base,
      include_all_networks: true,
      include_apns: true,
      include_cellular_services: true,
    });
    expect(parsed).toMatchObject({ include_all_networks: true, include_apns: true });
  });

  it("拒绝缺少 include_all_networks 的子开关,并逐个指出字段", () => {
    for (const field of ["include_local_networks", "include_apns", "include_cellular_services"] as const) {
      const result = generalPresetSchema.safeParse({ ...base, [field]: true });
      expect(result.success).toBe(false);
      if (result.success) continue;
      expect(result.error.issues[0]?.path).toEqual([field]);
      expect(result.error.issues[0]?.message).toContain("include-all-networks");
    }
    // include_all_networks 显式 false 与缺省同等对待
    expect(generalPresetSchema.safeParse({ ...base, include_all_networks: false, include_apns: true }).success).toBe(
      false,
    );
  });

  it("子开关为 false 或缺省时不受依赖约束", () => {
    expect(generalPresetSchema.safeParse({ ...base, include_apns: false }).success).toBe(true);
    expect(generalPresetSchema.safeParse(base).success).toBe(true);
  });
});

/**
 * `[SSID Setting]`(官方名 Subnet Settings)的条目从 `{ ssid, suspend, policy }` 改成
 * `{ match, ...全量参数 }`:match 存完整 subnet 表达式,才能表达 BSSID / ROUTER / TYPE / MCCMNC;
 * `policy` 在 Surge 手册里从来不属于本段,一并丢弃。
 */
describe("generalPresetSchema — ssid_rules 结构迁移", () => {
  const base = { id: "g", name: "g" };
  const parse = (ssid_rules: unknown) => generalPresetSchema.parse({ ...base, ssid_rules }).ssid_rules;

  it("老 { ssid } 折成 match: SSID:<name>,并丢掉 policy", () => {
    expect(parse([{ ssid: "Forever.", suspend: true }, { ssid: "Office", policy: "DIRECT" }])).toEqual([
      { match: "SSID:Forever.", suspend: true },
      { match: "SSID:Office" },
    ]);
  });

  it("新结构直通,新参数保留", () => {
    expect(
      parse([
        {
          match: "TYPE:CELLULAR",
          cellular_fallback: "off",
          cellular_mode: true,
          tfo_behaviour: "auto",
          dns_server: ["system"],
          encrypted_dns_server: ["off"],
        },
      ]),
    ).toEqual([
      {
        match: "TYPE:CELLULAR",
        cellular_fallback: "off",
        cellular_mode: true,
        tfo_behaviour: "auto",
        dns_server: ["system"],
        encrypted_dns_server: ["off"],
      },
    ]);
  });

  // 老 UI 点了"添加"没填就保存会留下 { ssid: "" };让整份 general 文件加载失败
  // 远比生成时报一条 warning 糟糕,所以空值放行,由 generator 跳过。
  it("空 ssid 迁移成空 match 而不是抛错", () => {
    expect(parse([{ ssid: "" }])).toEqual([{ match: "" }]);
  });

  it("非法取值仍然拒绝", () => {
    expect(() => parse([{ match: "SSID:Home", tfo_behaviour: "on" }])).toThrow();
    expect(() => parse([{ match: "SSID:Home", cellular_fallback: "yes" }])).toThrow();
  });
});
