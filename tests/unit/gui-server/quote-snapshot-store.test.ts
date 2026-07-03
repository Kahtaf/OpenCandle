import { describe, expect, it } from "vitest";
import type { MarketStateQuoteSnapshot } from "../../../gui/server/market-state-api.js";
import { QuoteSnapshotStore } from "../../../gui/server/quote-snapshot-store.js";

function snapshot(generatedAt: string): MarketStateQuoteSnapshot {
  return {
    generatedAt,
    watchlistQuotes: [],
    portfolioQuotes: [],
    portfolioSummary: {
      baseCurrency: "USD",
      totalValue: 0,
      totalCost: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
      excludedFromTotals: [],
    },
  };
}

describe("market-state snapshot instruments", () => {
  it("includes instrument records referenced by alert rules", async () => {
    const { initDatabase } = await import("../../../src/memory/sqlite.js");
    const { MarketStateService } = await import("../../../src/market-state/service.js");
    const { buildMarketStateSnapshot } = await import("../../../gui/server/market-state-api.js");
    const db = initDatabase(":memory:");
    const service = new MarketStateService(db);
    const instrument = service.upsertInstrumentRecord({
      symbol: "NVDA",
      assetType: "equity",
      name: "NVIDIA Corporation",
      exchange: "NMS",
      currency: "USD",
      provider: "yahoo",
    });
    service.createAlertRule({
      scopeType: "instrument",
      instrumentId: instrument.id,
      conditionType: "price_crosses_above",
      conditionVersion: 1,
      condition: { type: "price_crosses_above", threshold: 220 },
      timeframe: "quote",
    });

    const snapshot = buildMarketStateSnapshot(db);

    expect(snapshot.instruments).toEqual([
      expect.objectContaining({ id: instrument.id, symbol: "NVDA", name: "NVIDIA Corporation" }),
    ]);
    db.close();
  });
});

describe("QuoteSnapshotStore", () => {
  it("builds and returns a snapshot on first get", async () => {
    let builds = 0;
    const store = new QuoteSnapshotStore(async () => {
      builds += 1;
      return snapshot("2026-06-12T14:00:00Z");
    });

    const result = await store.get();

    expect(result.generatedAt).toBe("2026-06-12T14:00:00Z");
    expect(builds).toBe(1);
  });

  it("serves the cached snapshot without rebuilding while fresh", async () => {
    let builds = 0;
    let nowMs = 0;
    const store = new QuoteSnapshotStore(
      async () => {
        builds += 1;
        return snapshot(`build-${builds}`);
      },
      60_000,
      () => nowMs,
    );

    await store.get();
    nowMs = 30_000;
    const second = await store.get();

    expect(second.generatedAt).toBe("build-1");
    expect(builds).toBe(1);
  });

  it("rebuilds the next snapshot after invalidation", async () => {
    let builds = 0;
    const store = new QuoteSnapshotStore(async () => {
      builds += 1;
      return snapshot(`build-${builds}`);
    });

    await store.get();
    store.invalidate();
    const refreshed = await store.get();

    expect(refreshed.generatedAt).toBe("build-2");
    expect(builds).toBe(2);
  });

  it("does not let invalidated in-flight builds overwrite newer snapshots", async () => {
    let builds = 0;
    let releaseFirstBuild: () => void = () => {};
    const store = new QuoteSnapshotStore(async () => {
      builds += 1;
      const build = builds;
      if (build === 1) {
        await new Promise<void>((resolvePromise) => {
          releaseFirstBuild = resolvePromise;
        });
      }
      return snapshot(`build-${build}`);
    });

    const staleBuild = store.get();
    store.invalidate();
    const refreshed = await store.get();
    releaseFirstBuild();
    await staleBuild;

    const current = await store.get();
    expect(refreshed.generatedAt).toBe("build-2");
    expect(current.generatedAt).toBe("build-2");
  });

  it("returns the stale snapshot immediately and revalidates in the background", async () => {
    let builds = 0;
    let nowMs = 0;
    let releaseSecondBuild: () => void = () => {};
    const store = new QuoteSnapshotStore(
      async () => {
        builds += 1;
        if (builds > 1) {
          await new Promise<void>((resolvePromise) => {
            releaseSecondBuild = resolvePromise;
          });
        }
        return snapshot(`build-${builds}`);
      },
      60_000,
      () => nowMs,
    );

    await store.get();
    nowMs = 120_000;
    const staleServed = await store.get();

    expect(staleServed.generatedAt).toBe("build-1");
    expect(builds).toBe(2);

    releaseSecondBuild();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    const refreshed = await store.get();
    expect(refreshed.generatedAt).toBe("build-2");
  });

  it("shares a single in-flight build across concurrent gets", async () => {
    let builds = 0;
    let release: () => void = () => {};
    const store = new QuoteSnapshotStore(async () => {
      builds += 1;
      await new Promise<void>((resolvePromise) => {
        release = resolvePromise;
      });
      return snapshot(`build-${builds}`);
    });

    const first = store.get();
    const second = store.get();
    release();
    const [a, b] = await Promise.all([first, second]);

    expect(a.generatedAt).toBe("build-1");
    expect(b.generatedAt).toBe("build-1");
    expect(builds).toBe(1);
  });

  it("keeps serving the last snapshot when a background revalidation fails", async () => {
    let builds = 0;
    let nowMs = 0;
    const store = new QuoteSnapshotStore(
      async () => {
        builds += 1;
        if (builds > 1) throw new Error("provider down");
        return snapshot("build-1");
      },
      60_000,
      () => nowMs,
    );

    await store.get();
    nowMs = 120_000;
    const served = await store.get();
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 0));
    const afterFailure = await store.get();

    expect(served.generatedAt).toBe("build-1");
    expect(afterFailure.generatedAt).toBe("build-1");
    expect(builds).toBeGreaterThanOrEqual(2);
  });
});
