import { describe, expect, it } from "vitest";
import { appConfigSchema } from "../../src/schemas/config.js";
import { isValidAllowlistEntry } from "../../src/auth/middleware.js";

const baseConfig = {
  admin: {
    username: "admin",
    password_hash: "$2a$10$fakehash",
    must_change_password: false,
  },
};

/**
 * 回归:Web UI 的「新增」按钮会先塞一个空字符串占位,用户没填就保存时
 * config.yaml 里会留下 `- ""`。白名单因此"非空但匹配不上任何 IP",
 * 而 PUT /api/config 自己也在白名单后面 → 管理员登录成功但所有 /api/* 403,
 * 且无法从设置页救回来。schema 必须在读写两侧都把这类条目清掉。
 */
describe("appConfigSchema — ip_allowlist 清洗", () => {
  it("丢弃空字符串与纯空白条目", () => {
    const cfg = appConfigSchema.parse({ ...baseConfig, ip_allowlist: ["", "   ", ""] });
    expect(cfg.ip_allowlist).toEqual([]);
  });

  it("保留有效条目并 trim 首尾空白", () => {
    const cfg = appConfigSchema.parse({
      ...baseConfig,
      ip_allowlist: [" 192.168.1.0/24 ", "", "1.2.3.4"],
    });
    expect(cfg.ip_allowlist).toEqual(["192.168.1.0/24", "1.2.3.4"]);
  });

  it("缺省时为空数组(放行所有 IP)", () => {
    expect(appConfigSchema.parse(baseConfig).ip_allowlist).toEqual([]);
  });
});

describe("isValidAllowlistEntry", () => {
  it.each(["1.2.3.4", "192.168.1.0/24", "10.0.0.0/8", "0.0.0.0/0", "::1", "fe80::1"])(
    "接受 %s",
    (entry) => {
      expect(isValidAllowlistEntry(entry)).toBe(true);
    },
  );

  it.each(["", "1.2.3", "1.2.3.4.5", "256.1.1.1", "10.0.0.0/33", "10.0.0.0/-1", "10.0.0.0/8/8", "abc"])(
    "拒绝 %s",
    (entry) => {
      expect(isValidAllowlistEntry(entry)).toBe(false);
    },
  );
});
