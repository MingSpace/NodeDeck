import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "../../src/schemas/provider.js";

vi.mock("../../src/providers/load.js", () => ({ refreshProvider: vi.fn() }));
vi.mock("../../src/storage/repos.js", () => ({ providerRepo: { list: vi.fn() } }));

import { refreshProvider } from "../../src/providers/load.js";
import { providerRepo } from "../../src/storage/repos.js";
import { runSchedulerTick } from "../../src/providers/scheduler.js";

const mockedRefresh = refreshProvider as unknown as ReturnType<typeof vi.fn>;
const mockedList = providerRepo.list as unknown as ReturnType<typeof vi.fn>;

function entry(id: string) {
  return { id, path: "", mtimeMs: 0, data: { id, enabled: true, refresh: { interval: "24h" } } as Provider };
}

beforeEach(() => {
  mockedRefresh.mockReset();
  mockedList.mockReset().mockResolvedValue([entry("slow"), entry("fast")]);
});

describe("runSchedulerTick", () => {
  it("上一次还没拉完的节点源,下一个 tick 跳过,不对同一个机场并发再拉一轮", async () => {
    let finishSlow!: () => void;
    mockedRefresh.mockImplementationOnce(() => new Promise<void>((resolve) => (finishSlow = resolve)));
    mockedRefresh.mockResolvedValue(undefined);

    const first = runSchedulerTick();
    await vi.waitFor(() => expect(mockedRefresh).toHaveBeenCalledTimes(2));
    await runSchedulerTick();

    const ids = mockedRefresh.mock.calls.map(([p]) => (p as Provider).id);
    expect(ids).toEqual(["slow", "fast", "fast"]);

    finishSlow();
    await first;
    await runSchedulerTick();
    expect(mockedRefresh.mock.calls.at(-2)?.[0]).toMatchObject({ id: "slow" });
  });
});
