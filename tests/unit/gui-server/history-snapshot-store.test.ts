import { describe, expect, it, vi } from "vitest";
import { HistorySnapshotStore } from "../../../gui/server/history-snapshot-store.js";

describe("HistorySnapshotStore", () => {
  it("serves a fresh per-key entry without calling the builder", async () => {
    let nowMs = 0;
    const store = new HistorySnapshotStore<string>(60_000, () => nowMs);
    await store.get("AAPL|1d|5m", async () => "first");
    nowMs = 10_000;
    const build = vi.fn(async () => "second");

    await expect(store.get("AAPL|1d|5m", build)).resolves.toBe("first");
    expect(build).not.toHaveBeenCalled();
  });

  it("coalesces five concurrent cold-key requests into one build", async () => {
    const store = new HistorySnapshotStore<string>();
    let release: (value: string) => void = () => {};
    const build = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          release = resolve;
        }),
    );

    const requests = Array.from({ length: 5 }, () => store.get("AAPL|1d|5m", build));
    release("snapshot");

    await expect(Promise.all(requests)).resolves.toEqual(Array(5).fill("snapshot"));
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("rebuilds an expired entry", async () => {
    let nowMs = 0;
    const store = new HistorySnapshotStore<string>(60_000, () => nowMs);
    await store.get("AAPL|1d|5m", async () => "first");
    nowMs = 60_000;
    const build = vi.fn(async () => "second");

    await expect(store.get("AAPL|1d|5m", build)).resolves.toBe("second");
    expect(build).toHaveBeenCalledTimes(1);
  });

  it("clears a rejected in-flight build so the next call retries", async () => {
    const store = new HistorySnapshotStore<string>();
    const build = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("provider down"))
      .mockResolvedValueOnce("recovered");

    await expect(store.get("AAPL|1d|5m", build)).rejects.toThrow("provider down");
    await expect(store.get("AAPL|1d|5m", build)).resolves.toBe("recovered");
    expect(build).toHaveBeenCalledTimes(2);
  });
});
