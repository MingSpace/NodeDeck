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
