import { describe, expect, it } from "vitest";
import type { MarketIndicesSnapshot } from "../../../gui/server/market-indices-api.js";
import { MarketIndicesSnapshotStore } from "../../../gui/server/market-indices-snapshot-store.js";

function snapshot(generatedAt: string): MarketIndicesSnapshot {
  return {
    generatedAt,
    indices: [{ symbol: "^GSPC", status: "ok", price: 6000, stale: false }],
  };
}

describe("MarketIndicesSnapshotStore", () => {
  it("serves requests inside the freshness window from one build", async () => {
    let builds = 0;
    let nowMs = 0;
    let release: () => void = () => {};
    const store = new MarketIndicesSnapshotStore(
      async () => {
        builds += 1;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return snapshot(`build-${builds}`);
      },
      60_000,
      () => nowMs,
    );

    const firstRequest = store.get();
    const concurrentRequest = store.get();
    release();
    const [first, concurrent] = await Promise.all([firstRequest, concurrentRequest]);
    nowMs = 30_000;
    const second = await store.get();

    expect(first.generatedAt).toBe("build-1");
    expect(concurrent.generatedAt).toBe("build-1");
    expect(second.generatedAt).toBe("build-1");
    expect(builds).toBe(1);
  });

  it("serves stale data immediately while refreshing in the background", async () => {
    let builds = 0;
    let nowMs = 0;
    let releaseRefresh: () => void = () => {};
    const store = new MarketIndicesSnapshotStore(
      async () => {
        builds += 1;
        if (builds === 2) {
          await new Promise<void>((resolve) => {
            releaseRefresh = resolve;
          });
        }
        return snapshot(`build-${builds}`);
      },
      60_000,
      () => nowMs,
    );

    await store.get();
    nowMs = 60_000;
    const stale = await store.get();

    expect(stale.generatedAt).toBe("build-1");
    expect(stale.indices[0]?.stale).toBe(true);
    expect(builds).toBe(2);

    releaseRefresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const refreshed = await store.get();
    expect(refreshed.generatedAt).toBe("build-2");
    expect(refreshed.indices[0]?.stale).toBe(false);
  });

  it("keeps an expired snapshot marked stale when background refresh fails", async () => {
    let builds = 0;
    let nowMs = 0;
    const store = new MarketIndicesSnapshotStore(
      async () => {
        builds += 1;
        if (builds > 1) throw new Error("provider unavailable");
        return snapshot("initial");
      },
      60_000,
      () => nowMs,
    );

    await store.get();
    nowMs = 60_001;
    const stale = await store.get();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(stale.indices[0]).toMatchObject({ status: "ok", stale: true });
    expect((await store.get()).indices[0]).toMatchObject({ status: "ok", stale: true });
  });
});
