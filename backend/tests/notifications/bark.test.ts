import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendBark } from "../../src/notifications/bark.js";
import { barkConfigSchema, type BarkConfig } from "../../src/schemas/notification.js";

function cfg(overrides: Partial<BarkConfig> = {}): BarkConfig {
  return {
    ...barkConfigSchema.parse({
      enabled: true,
      device_key: "test-key",
    }),
    ...overrides,
  };
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sendBark", () => {
  it("POST {server}/push,JSON body 含 device_key/title/body/level/group", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    const result = await sendBark(cfg(), { title: "标题", body: "内容" });

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.day.app/push");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(String(init.body));
    expect(payload).toMatchObject({
      device_key: "test-key",
      title: "标题",
      body: "内容",
      level: "active",
      group: "NodeDeck",
    });
    // sound 未配置时不应出现在 payload 里
    expect(payload).not.toHaveProperty("sound");
  });

  it("server 末尾斜杠会被归一化,消息可覆盖 level", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await sendBark(cfg({ server: "https://bark.example.com/" }), {
      title: "t",
      body: "b",
      level: "timeSensitive",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://bark.example.com/push");
    expect(JSON.parse(String(init.body)).level).toBe("timeSensitive");
  });

  it("非 2xx 响应返回 ok=false 且不抛出", async () => {
    fetchMock.mockResolvedValue(new Response("device not found", { status: 400 }));
    const result = await sendBark(cfg(), { title: "t", body: "b" });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
  });

  it("网络异常返回 ok=false 且不抛出", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));
    const result = await sendBark(cfg(), { title: "t", body: "b" });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("device_key 为空时直接返回 ok=false,不发请求", async () => {
    const result = await sendBark(cfg({ device_key: "" }), { title: "t", body: "b" });
    expect(result.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
