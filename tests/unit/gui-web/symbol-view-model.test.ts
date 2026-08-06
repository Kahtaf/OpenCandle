import { describe, expect, it } from "vitest";
import {
  buildSymbolViewModel,
  deriveHorizonReturns,
  deriveKeyLevels,
  deriveTrendSummary,
  deriveVolumeContext,
  formatVolumeContext,
  historyBasisNote,
} from "../../../gui/web/src/features/symbol/symbol-view-model.js";

const DAY_SECONDS = 86_400;
// A fixed clock keeps every horizon boundary deterministic.
const LAST_BAR_SECONDS = Math.floor(Date.UTC(2026, 7, 5) / 1000);

interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function dailyBars({
  count,
  close = (index: number) => 100 + index,
  volume = () => 1_000_000,
  lastBarSeconds = LAST_BAR_SECONDS,
}: {
  count: number;
  close?: (index: number) => number;
  volume?: (index: number) => number;
  lastBarSeconds?: number;
}): Bar[] {
  const bars: Bar[] = [];
  for (let index = 0; index < count; index += 1) {
    const closeValue = close(index);
    bars.push({
      time: lastBarSeconds - (count - 1 - index) * DAY_SECONDS,
      open: closeValue,
      high: closeValue,
      low: closeValue,
      close: closeValue,
      volume: volume(index),
    });
  }
  return bars;
}

// 400 calendar days ending 2026-08-05: reaches back past 2025-08-05, so every
// horizon including year-to-date and the 52-week window is computable.
const FULL_YEAR = dailyBars({ count: 400 });
// 120 days ending 2026-08-05 starts inside 2026, so YTD, 1Y and the 52-week
// window are not computable while the shorter horizons are.
const PARTIAL_YEAR = dailyBars({ count: 120 });
const SPARSE = dailyBars({ count: 4 });

describe("deriveHorizonReturns", () => {
  it("computes every horizon from a full year of daily bars", () => {
    const entries = deriveHorizonReturns(FULL_YEAR, { currentPrice: 500 });
    expect(entries.map((entry) => entry.key)).toEqual([
      "week",
      "month",
      "ytd",
      "year",
      "fromHigh52w",
    ]);
    const byKey = new Map(entries.map((entry) => [entry.key, entry.percent]));
    // Closes run 100..499; the bar seven days before the last one closed at 492.
    expect(byKey.get("week")).toBeCloseTo((500 / 492 - 1) * 100, 6);
    expect(byKey.get("fromHigh52w")).toBeCloseTo(0, 6);
    for (const percent of byKey.values()) expect(Number.isFinite(percent)).toBe(true);
  });

  it("omits horizons the history cannot reach instead of reporting zero", () => {
    const entries = deriveHorizonReturns(PARTIAL_YEAR, { currentPrice: 219 });
    expect(entries.map((entry) => entry.key)).toEqual(["week", "month"]);
    expect(entries.every((entry) => entry.percent !== 0)).toBe(true);
  });

  it("omits the weekly horizon when only a few days of history exist", () => {
    expect(deriveHorizonReturns(SPARSE, { currentPrice: 104 })).toEqual([]);
  });

  it("returns nothing for empty history", () => {
    expect(deriveHorizonReturns([], { currentPrice: 100 })).toEqual([]);
    expect(deriveHorizonReturns(undefined, {})).toEqual([]);
  });

  it("reports a negative distance from the 52-week high", () => {
    const entries = deriveHorizonReturns(FULL_YEAR, { currentPrice: 400 });
    const fromHigh = entries.find((entry) => entry.key === "fromHigh52w");
    // The window high is the last close of 499.
    expect(fromHigh?.percent).toBeCloseTo((400 / 499 - 1) * 100, 6);
    expect(fromHigh?.percent).toBeLessThan(0);
  });

  it("falls back to the last close when no live price is supplied", () => {
    const entries = deriveHorizonReturns(FULL_YEAR, {});
    const week = entries.find((entry) => entry.key === "week");
    expect(week?.percent).toBeCloseTo((499 / 492 - 1) * 100, 6);
  });
});

describe("deriveVolumeContext", () => {
  it("compares the session volume with the prior 30 daily bars", () => {
    const bars = dailyBars({ count: 60, volume: () => 1_000_000 });
    const context = deriveVolumeContext(bars, { volume: 12_400_000 });
    expect(context).toMatchObject({ volume: 12_400_000, averageVolume: 1_000_000 });
    expect(context?.multiple).toBeCloseTo(12.4, 6);
  });

  it("formats the volume beside its multiple of the average", () => {
    const bars = dailyBars({ count: 60, volume: () => 15_500_000 });
    expect(formatVolumeContext(deriveVolumeContext(bars, { volume: 12_400_000 }))).toBe(
      "12.4M · 0.8× avg",
    );
  });

  it("keeps the volume without a multiple when 30 prior bars are missing", () => {
    const bars = dailyBars({ count: 12, volume: () => 2_000_000 });
    const context = deriveVolumeContext(bars, { volume: 3_000_000 });
    expect(context).toEqual({ volume: 3_000_000, averageVolume: null, multiple: null });
    expect(formatVolumeContext(context)).toBe("3M");
  });

  it("reports no volume for instruments that do not report one", () => {
    const bars = dailyBars({ count: 60, volume: () => 0 });
    expect(deriveVolumeContext(bars, { volume: 0 })).toBeNull();
    expect(deriveVolumeContext(bars, {})).toBeNull();
    expect(deriveVolumeContext([], { volume: 0 })).toBeNull();
    expect(formatVolumeContext(null)).toBeNull();
  });
});

describe("deriveKeyLevels", () => {
  it("returns each computable level with its signed distance from the price", () => {
    const levels = deriveKeyLevels(FULL_YEAR, { currentPrice: 400 });
    expect(levels.map((level) => level.key)).toEqual(["week52High", "week52Low", "sma20", "sma50"]);
    expect(levels.map((level) => level.label)).toEqual([
      "52-week high",
      "52-week low",
      "20-day average",
      "50-day average",
    ]);
    const high = levels[0];
    expect(high.value).toBe(499);
    expect(high.distancePercent).toBeCloseTo((499 / 400 - 1) * 100, 6);
    expect(levels[2].value).toBeCloseTo(489.5, 6);
    expect(levels[3].value).toBeCloseTo(474.5, 6);
  });

  it("counts the live price inside the 52-week range", () => {
    // A price above every fetched bar is the new high, exactly as the hero
    // strip already reports it. Leaving it out would offer an alert at a level
    // the price has already passed.
    const high = deriveKeyLevels(FULL_YEAR, { currentPrice: 600 }).find(
      (level) => level.key === "week52High",
    );
    expect(high?.value).toBe(600);
    expect(high?.distancePercent).toBeCloseTo(0, 6);
    expect(
      deriveHorizonReturns(FULL_YEAR, { currentPrice: 600 }).find(
        (entry) => entry.key === "fromHigh52w",
      )?.percent,
    ).toBeCloseTo(0, 6);

    const low = deriveKeyLevels(FULL_YEAR, { currentPrice: 50 }).find(
      (level) => level.key === "week52Low",
    );
    expect(low?.value).toBe(50);
    expect(low?.distancePercent).toBeCloseTo(0, 6);
  });

  it("counts the session's own high and low inside the 52-week range", () => {
    // The daily history can still end at yesterday while the quote already
    // carries today's range, so a new high set intraday and given back must
    // not be reported as the current price.
    const levels = deriveKeyLevels(FULL_YEAR, {
      currentPrice: 480,
      sessionHigh: 620,
      sessionLow: 40,
    });
    expect(levels.find((level) => level.key === "week52High")?.value).toBe(620);
    expect(levels.find((level) => level.key === "week52Low")?.value).toBe(40);
    expect(
      deriveHorizonReturns(FULL_YEAR, { currentPrice: 480, sessionHigh: 620 }).find(
        (entry) => entry.key === "fromHigh52w",
      )?.percent,
    ).toBeCloseTo((480 / 620 - 1) * 100, 6);
  });

  it("omits levels the history cannot support", () => {
    expect(deriveKeyLevels(PARTIAL_YEAR, { currentPrice: 219 }).map((level) => level.key)).toEqual([
      "sma20",
      "sma50",
    ]);
    expect(deriveKeyLevels(dailyBars({ count: 25 }), { currentPrice: 124 })).toHaveLength(1);
    expect(deriveKeyLevels([], { currentPrice: 100 })).toEqual([]);
  });
});

describe("deriveTrendSummary", () => {
  it("states a consistent downtrend across all three averages", () => {
    const summary = deriveTrendSummary(FULL_YEAR, { currentPrice: 1 });
    expect(summary.rows.map((row) => [row.label, row.stateLabel])).toEqual([
      ["20-day average", "Below"],
      ["50-day average", "Below"],
      ["200-day average", "Below"],
    ]);
    expect(summary.sentence).toBe("Price is below its 20, 50 and 200 day averages.");
  });

  it("states a consistent uptrend across all three averages", () => {
    const summary = deriveTrendSummary(FULL_YEAR, { currentPrice: 10_000 });
    expect(summary.rows.every((row) => row.state === "above")).toBe(true);
    expect(summary.sentence).toBe("Price is above its 20, 50 and 200 day averages.");
  });

  it("names mixed signals without asserting one trend", () => {
    // Sits below the 20-day average (489.5) and above the 50 and 200 day ones.
    const summary = deriveTrendSummary(FULL_YEAR, { currentPrice: 480 });
    expect(summary.rows.map((row) => row.state)).toEqual(["below", "above", "above"]);
    expect(summary.sentence).toBe(
      "Signals are mixed: price is above its 50 and 200 day averages and below its 20 day average.",
    );
  });

  it("covers only the horizons a partial history supports", () => {
    const summary = deriveTrendSummary(dailyBars({ count: 25 }), { currentPrice: 1_000 });
    expect(summary.rows.map((row) => row.key)).toEqual(["sma20"]);
    expect(summary.sentence).toBe("Price is above its 20 day average.");
  });

  it("has no rows and no sentence without enough history", () => {
    expect(deriveTrendSummary(SPARSE, { currentPrice: 100 })).toEqual({ rows: [], sentence: null });
    expect(deriveTrendSummary([], {})).toEqual({ rows: [], sentence: null });
  });

  it("never writes an em dash", () => {
    for (const price of [1, 480, 10_000]) {
      expect(deriveTrendSummary(FULL_YEAR, { currentPrice: price }).sentence).not.toContain("—");
    }
  });
});

describe("buildSymbolViewModel", () => {
  it("assembles the derived stats from history and the quote", () => {
    const view = buildSymbolViewModel({
      bars: FULL_YEAR,
      quote: {
        status: "ok",
        price: 400,
        currency: "EUR",
        volume: 12_400_000,
        high: 405,
        low: 395,
      },
    });
    expect(view.currentPrice).toBe(400);
    expect(view.currency).toBe("EUR");
    expect(view.dayRange).toEqual({ low: 395, high: 405 });
    expect(view.horizonReturns.map((entry) => entry.key)).toContain("ytd");
    expect(view.keyLevels).toHaveLength(4);
    expect(view.trend.sentence).toBeTruthy();
    expect(view.volumeLabel).toMatch(/× avg$/);
    expect(view.hasDailyHistory).toBe(true);
  });

  it("degrades to empty derivations without history or a quote", () => {
    const view = buildSymbolViewModel({});
    expect(view).toMatchObject({
      currentPrice: null,
      currency: null,
      dayRange: null,
      horizonReturns: [],
      keyLevels: [],
      volume: null,
      volumeLabel: null,
      hasDailyHistory: false,
    });
    expect(view.trend).toEqual({ rows: [], sentence: null });
  });

  it("hands the quote's own session range to the 52-week levels", () => {
    const view = buildSymbolViewModel({
      bars: FULL_YEAR,
      quote: { status: "ok", price: 600, high: 620, low: 590 },
    });
    expect(view.keyLevels.find((level) => level.key === "week52High")?.value).toBe(620);
    expect(view.horizonReturns.find((entry) => entry.key === "fromHigh52w")?.percent).toBeCloseTo(
      (600 / 620 - 1) * 100,
      6,
    );
  });

  it("reads the session range from a saved-state quote's own field names", () => {
    // The watchlist snapshot the page prefers for a saved symbol names the
    // session bounds dayHigh and dayLow.
    const view = buildSymbolViewModel({
      bars: FULL_YEAR,
      quote: { status: "ok", price: 600, dayHigh: 620, dayLow: 590 },
    });
    expect(view.dayRange).toEqual({ low: 590, high: 620 });
    expect(view.keyLevels.find((level) => level.key === "week52High")?.value).toBe(620);
  });

  it("carries the history freshness the page has to disclose", () => {
    const view = buildSymbolViewModel({
      bars: FULL_YEAR,
      quote: { status: "ok", price: 400 },
      historyStale: true,
      historyAsOf: "2026-08-01",
    });
    expect(view.historyStale).toBe(true);
    expect(view.historyAsOf).toBe("2026-08-01");
  });

  it("reports current history as current", () => {
    const view = buildSymbolViewModel({ bars: FULL_YEAR, quote: { status: "ok", price: 400 } });
    expect(view.historyStale).toBe(false);
    expect(view.historyAsOf).toBeNull();
  });

  it("ignores intraday bars so daily averages are never faked", () => {
    const intraday = Array.from({ length: 300 }, (_, index) => ({
      time: LAST_BAR_SECONDS - (299 - index) * 3600,
      open: 100,
      high: 100,
      low: 100,
      close: 100,
      volume: 1_000,
    }));
    const view = buildSymbolViewModel({ bars: intraday, quote: { status: "ok", price: 100 } });
    expect(view.hasDailyHistory).toBe(false);
    expect(view.keyLevels).toEqual([]);
    expect(view.trend.rows).toEqual([]);
    expect(view.horizonReturns).toEqual([]);
  });
});

describe("historyBasisNote", () => {
  const NOW_MS = Date.UTC(2026, 7, 6);

  it("says nothing while the history behind the derived stats is current", () => {
    const view = buildSymbolViewModel({ bars: FULL_YEAR, quote: { status: "ok", price: 400 } });
    expect(historyBasisNote(view, NOW_MS)).toBeNull();
  });

  it("names the date the stale history stops at", () => {
    const view = buildSymbolViewModel({
      bars: FULL_YEAR,
      quote: { status: "ok", price: 400 },
      historyStale: true,
      historyAsOf: "2026-08-01",
    });
    expect(historyBasisNote(view, NOW_MS)).toBe("Price history as of Aug 1");
  });

  it("still discloses stale history that carries no date", () => {
    const view = buildSymbolViewModel({
      bars: FULL_YEAR,
      quote: { status: "ok", price: 400 },
      historyStale: true,
    });
    expect(historyBasisNote(view, NOW_MS)).toBe("Price history is not current");
  });
});
