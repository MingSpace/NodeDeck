import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "../../src/schemas/provider.js";
import {
  defaultNotificationConfig,
  type NotificationConfig,
} from "../../src/schemas/notification.js";

vi.mock("../../src/storage/notification-store.js", () => ({
  loadNotificationConfig: vi.fn(),
}));
vi.mock("../../src/notifications/bark.js", () => ({
  sendBark: vi.fn(),
}));
// state 落盘走 yaml-io,mock 掉避免触碰真实文件系统
vi.mock("../../src/storage/yaml-io.js", () => ({
  readJson: vi.fn().mockResolvedValue(null),
  writeJson: vi.fn().mockResolvedValue(undefined),
}));

import { loadNotificationConfig } from "../../src/storage/notification-store.js";
import { sendBark } from "../../src/notifications/bark.js";
import { __resetStateForTest } from "../../src/notifications/state.js";
import {
  notifyProviderRefreshFailed,
  notifyProviderZeroNodes,
  onProviderRefreshSucceeded,
  notifySubError,
  notifySubWarnings,
} from "../../src/notifications/service.js";
import { providerSchema } from "../../src/schemas/provider.js";

const mockedLoadConfig = loadNotificationConfig as unknown as ReturnType<typeof vi.fn>;
const mockedSendBark = sendBark as unknown as ReturnType<typeof vi.fn>;

function enabledConfig(overrides?: (cfg: NotificationConfig) => void): NotificationConfig {
  const cfg = defaultNotificationConfig();
  cfg.bark.enabled = true;
  cfg.bark.device_key = "key";
  overrides?.(cfg);
  return cfg;
}

function httpProvider(id = "p1"): Provider {
  return providerSchema.parse({
    id,
    name: `机场 ${id}`,
    type: "http",
    url: "https://airport.example.com/sub",
  }) as Provider;
}

beforeEach(() => {
  __resetStateForTest({});
  mockedLoadConfig.mockReset().mockResolvedValue(enabledConfig());
  mockedSendBark.mockReset().mockResolvedValue({ ok: true, status: 200 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("notifyProviderRefreshFailed", () => {
  it("http 源首次失败推送一次,冷却期内重复失败不再推", async () => {
    const p = httpProvider();
    await notifyProviderRefreshFailed(p, "timeout");
    await notifyProviderRefreshFailed(p, "timeout again");
    expect(mockedSendBark).toHaveBeenCalledTimes(1);
    expect(mockedSendBark.mock.calls[0][1].title).toBe("节点源刷新失败");
    expect(mockedSendBark.mock.calls[0][1].body).toContain("timeout");
  });

  it("刷新成功清除状态后,再次失败立即重推", async () => {
    const p = httpProvider();
    await notifyProviderRefreshFailed(p, "boom");
    await onProviderRefreshSucceeded(p);
    await notifyProviderRefreshFailed(p, "boom again");
    expect(mockedSendBark).toHaveBeenCalledTimes(2);
  });

  it("非 http(inline/file)源不推送", async () => {
    const p = providerSchema.parse({
      id: "local",
      name: "本地",
      type: "inline",
      content: "ss://x",
    }) as Provider;
    await notifyProviderRefreshFailed(p, "err");
    expect(mockedSendBark).not.toHaveBeenCalled();
  });

  it("bark 总开关关闭时不推送", async () => {
    mockedLoadConfig.mockResolvedValue(defaultNotificationConfig());
    await notifyProviderRefreshFailed(httpProvider(), "err");
    expect(mockedSendBark).not.toHaveBeenCalled();
  });

  it("refresh_failure 事件单独关闭时不推送", async () => {
    mockedLoadConfig.mockResolvedValue(
      enabledConfig((c) => {
        c.events.refresh_failure.enabled = false;
      }),
    );
    await notifyProviderRefreshFailed(httpProvider(), "err");
    expect(mockedSendBark).not.toHaveBeenCalled();
  });
});

describe("notifyProviderZeroNodes", () => {
  it("开启时推送,与 refresh_failure 独立计冷却 key", async () => {
    const p = httpProvider();
    await notifyProviderZeroNodes(p, "content 为空");
    await notifyProviderRefreshFailed(p, "timeout");
    expect(mockedSendBark).toHaveBeenCalledTimes(2);
  });

  it("zero_nodes 关闭时不推送", async () => {
    mockedLoadConfig.mockResolvedValue(
      enabledConfig((c) => {
        c.events.zero_nodes.enabled = false;
      }),
    );
    await notifyProviderZeroNodes(httpProvider(), "空");
    expect(mockedSendBark).not.toHaveBeenCalled();
  });
});

describe("onProviderRefreshSucceeded - userinfo 阈值告警", () => {
  const DAY = 86_400;
  const GB = 1024 ** 3;

  function expiringUserinfo() {
    return {
      upload: 0,
      download: 0,
      total: 0,
      expire: Math.floor(Date.now() / 1000) + 2 * DAY,
    };
  }

  it("到期剩余天数跌破阈值时推送,24h 内不重复", async () => {
    const p = httpProvider();
    await onProviderRefreshSucceeded(p, expiringUserinfo());
    await onProviderRefreshSucceeded(p, expiringUserinfo());
    expect(mockedSendBark).toHaveBeenCalledTimes(1);
    expect(mockedSendBark.mock.calls[0][1].title).toBe("订阅即将到期");
  });

  it("恢复阈值之上(续费)后再次跌破立即重推", async () => {
    const p = httpProvider();
    await onProviderRefreshSucceeded(p, expiringUserinfo());
    // 续费成功:剩余 30 天
    await onProviderRefreshSucceeded(p, {
      upload: 0,
      download: 0,
      total: 0,
      expire: Math.floor(Date.now() / 1000) + 30 * DAY,
    });
    await onProviderRefreshSucceeded(p, expiringUserinfo());
    expect(mockedSendBark).toHaveBeenCalledTimes(2);
  });

  it("流量跌破阈值时推送,流量用尽用不同标题", async () => {
    const p = httpProvider();
    await onProviderRefreshSucceeded(p, { upload: 96 * GB, download: 0, total: 100 * GB, expire: 0 });
    expect(mockedSendBark.mock.calls[0][1].title).toBe("订阅流量告急");

    __resetStateForTest({});
    mockedSendBark.mockClear();
    await onProviderRefreshSucceeded(p, { upload: 100 * GB, download: GB, total: 100 * GB, expire: 0 });
    expect(mockedSendBark.mock.calls[0][1].title).toBe("订阅流量已用尽");
  });

  it("provider_ids 白名单外的 provider 不检查", async () => {
    mockedLoadConfig.mockResolvedValue(
      enabledConfig((c) => {
        c.events.userinfo_alert.provider_ids = ["other"];
      }),
    );
    await onProviderRefreshSucceeded(httpProvider("p1"), expiringUserinfo());
    expect(mockedSendBark).not.toHaveBeenCalled();
  });

  it("provider_ids=null 表示全部 provider 都检查", async () => {
    await onProviderRefreshSucceeded(httpProvider("any"), expiringUserinfo());
    expect(mockedSendBark).toHaveBeenCalledTimes(1);
  });

  it("无 userinfo 时只清状态不推送", async () => {
    await onProviderRefreshSucceeded(httpProvider());
    expect(mockedSendBark).not.toHaveBeenCalled();
  });
});

describe("notifySubError / notifySubWarnings", () => {
  it("sub_error 相同内容 1h 内只推一次,不同内容分别推", async () => {
    await notifySubError("/sub", "resolve failed");
    await notifySubError("/sub", "resolve failed");
    await notifySubError("/sub", "another error");
    expect(mockedSendBark).toHaveBeenCalledTimes(2);
  });

  it("sub_warnings 默认关闭不推送;开启后按内容 hash 去重", async () => {
    await notifySubWarnings("home", "clash", ["w1"]);
    expect(mockedSendBark).not.toHaveBeenCalled();

    mockedLoadConfig.mockResolvedValue(
      enabledConfig((c) => {
        c.events.sub_warnings.enabled = true;
      }),
    );
    await notifySubWarnings("home", "clash", ["w1", "w2"]);
    await notifySubWarnings("home", "clash", ["w1", "w2"]);
    await notifySubWarnings("home", "clash", ["w3"]);
    expect(mockedSendBark).toHaveBeenCalledTimes(2);
  });

  it("warnings 超过 5 条时截断并标注总数", async () => {
    mockedLoadConfig.mockResolvedValue(
      enabledConfig((c) => {
        c.events.sub_warnings.enabled = true;
      }),
    );
    const warnings = Array.from({ length: 8 }, (_, i) => `warning-${i}`);
    await notifySubWarnings("home", "surge", warnings);
    const body = mockedSendBark.mock.calls[0][1].body as string;
    expect(body).toContain("warning-4");
    expect(body).not.toContain("warning-5");
    expect(body).toContain("共 8 条");
  });
});
