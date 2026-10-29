import { describe, expect, it } from "vitest";
import { providerSchema } from "../../src/schemas/provider.js";

describe("providerSchema url", () => {
  it("静态节点带着切换前留下的 URL 草稿,落盘时丢掉", () => {
    const p = providerSchema.parse({
      id: "static",
      name: "静态",
      type: "inline",
      url: "https://example.com/subscribe?token=your-token-here",
      content: "ss://YWVzLTEyOC1nY206cGFzcw@1.2.3.4:8388#a",
    });
    expect(p.url).toBeUndefined();
  });

  it("清空 URL(空字符串)按没填处理,不报格式错误", () => {
    const p = providerSchema.parse({
      id: "static",
      name: "静态",
      type: "inline",
      url: "",
      content: "ss://YWVzLTEyOC1nY206cGFzcw@1.2.3.4:8388#a",
    });
    expect(p.url).toBeUndefined();
  });

  it("URL 订阅清空 URL 时报的是「缺 url」而不是格式错误", () => {
    const r = providerSchema.safeParse({ id: "sub", name: "订阅", type: "http", url: "  " });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toEqual(["http provider requires `url`"]);
  });

  it("URL 订阅的地址原样保留", () => {
    const p = providerSchema.parse({ id: "sub", name: "订阅", type: "http", url: "https://example.com/sub" });
    expect(p.url).toBe("https://example.com/sub");
  });
});
