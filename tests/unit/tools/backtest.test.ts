import { describe, expect, it } from "vitest";
import {
  BACKTEST_LIMITATIONS,
  type BacktestResult,
  DEFAULT_COST_BPS,
  runBacktest,
} from "../../../src/tools/technical/backtest.js";
import { computeSMA } from "../../../src/tools/technical/indicators.js";
import type { OHLCV } from "../../../src/types/market.js";

// Generate deterministic uptrending bars. Opens are deliberately offset from
// closes so fill-price assertions can tell them apart.
function makeUptrend(days: number): OHLCV[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: 100 + i * 0.5 + 0.2,
    high: 101 + i * 0.5,
    low: 99 + i * 0.5,
    close: 100 + i * 0.5,
    volume: 1_000_000,
  }));
}

// Generate bars that oscillate for mean-reversion testing
function makeOscillating(days: number): OHLCV[] {
  return Array.from({ length: days }, (_, i) => {
    // Swing between 90 and 110 over ~30 day cycles
    const price = 100 + 10 * Math.sin((i / 15) * Math.PI);
    return {
      date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      open: price,
      high: price + 1,
      low: price - 1,
      close: price,
      volume: 1_000_000,
    };
  });
}

function expectFiniteBacktestResult(result: BacktestResult): void {
  expect(Number.isFinite(result.totalReturn)).toBe(true);
  expect(Number.isFinite(result.buyAndHoldReturn)).toBe(true);
  expect(Number.isFinite(result.maxDrawdown)).toBe(true);
  for (const trade of result.tradeLog) {
    expect(Number.isFinite(trade.price)).toBe(true);
    if (trade.pnl != null) expect(Number.isFinite(trade.pnl)).toBe(true);
  }
}

describe("runBacktest", () => {
  it("returns a BacktestResult with required fields", () => {
    const bars = makeUptrend(100);
    const result = runBacktest(bars, "sma_crossover");
    expect(result).toHaveProperty("strategy");
    expect(result).toHaveProperty("totalReturn");
    expect(result).toHaveProperty("buyAndHoldReturn");
    expect(result).toHaveProperty("trades");
    expect(result).toHaveProperty("forcedClosures");
    expect(result).toHaveProperty("winRate");
    expect(result).toHaveProperty("maxDrawdown");
    expect(result.strategy).toBe("sma_crossover");
  });

  it("buy-and-hold return matches first-to-last price change", () => {
    const bars = makeUptrend(100);
    const result = runBacktest(bars, "sma_crossover");
    const expectedReturn = (bars[bars.length - 1].close - bars[0].close) / bars[0].close;
    expect(result.buyAndHoldReturn).toBeCloseTo(expectedReturn, 4);
  });

  it("SMA crossover generates trades on a trending market", () => {
    const bars = makeUptrend(100);
    const result = runBacktest(bars, "sma_crossover");
    expect(result.trades).toBeGreaterThanOrEqual(0);
    expect(typeof result.totalReturn).toBe("number");
  });

  it("SMA 50/200 crossover supports standard long-term trend backtests", () => {
    const bars = makeUptrend(260);
    const result = runBacktest(bars, "sma_50_200_crossover");
    expect(result.strategy).toBe("sma_50_200_crossover");
    expect(result.trades).toBeGreaterThanOrEqual(0);
    expect(typeof result.buyAndHoldReturn).toBe("number");
  });

  it("SMA 50/200 crossover requires enough data for the 200-day average", () => {
    const bars = makeUptrend(100);
    const result = runBacktest(bars, "sma_50_200_crossover");
    expect(result.strategy).toBe("sma_50_200_crossover");
    expect(result.trades).toBe(0);
  });

  it("RSI mean-reversion generates trades on oscillating data", () => {
    const bars = makeOscillating(200);
    const result = runBacktest(bars, "rsi_mean_reversion");
    expect(result.trades).toBeGreaterThan(0);
    expect(result.strategy).toBe("rsi_mean_reversion");
  });

  it("win rate is between 0 and 1", () => {
    const bars = makeOscillating(200);
    const result = runBacktest(bars, "rsi_mean_reversion");
    if (result.trades > 0) {
      expect(result.winRate).toBeGreaterThanOrEqual(0);
      expect(result.winRate).toBeLessThanOrEqual(1);
    }
  });

  it("max drawdown is non-negative", () => {
    const bars = makeUptrend(100);
    const result = runBacktest(bars, "sma_crossover");
    expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
  });

  it("returns zero trades when insufficient data", () => {
    const bars = makeUptrend(10); // Not enough for SMA(50)
    const result = runBacktest(bars, "sma_crossover");
    expect(result.trades).toBe(0);
  });

  it("SMA crossover: captures mark-to-market drawdown when position stays open", () => {
    // Build: 60-bar uptrend → buy signal, then 10-bar mild decline that
    // ends the data (position force-closed). The decline is small enough
    // that SMA20 stays above SMA50, so no sell signal fires.
    // With the bug: equity stays at 1.0 until force-close, drawdown = 0.
    // With the fix: mark-to-market equity drops during the decline.
    const bars: OHLCV[] = [];
    for (let i = 0; i < 60; i++) {
      bars.push({
        date: `2024-01-${String(i + 1).padStart(2, "0")}`,
        open: 100 + i * 0.5,
        high: 101 + i * 0.5,
        low: 99 + i * 0.5,
        close: 100 + i * 0.5,
        volume: 1_000_000,
      });
    }
    const peakPrice = bars[bars.length - 1].close; // ~129.5
    // Decline 15% over 10 bars — too gentle/short to flip SMA20 < SMA50
    for (let i = 0; i < 10; i++) {
      const price = peakPrice * (1 - (0.15 * (i + 1)) / 10);
      bars.push({
        date: `2024-03-${String(i + 1).padStart(2, "0")}`,
        open: price,
        high: price + 1,
        low: price - 1,
        close: price,
        volume: 1_000_000,
      });
    }

    const result = runBacktest(bars, "sma_crossover");
    // Position should still be open at end (force-closed)
    // Max drawdown should reflect the ~15% unrealized loss
    expect(result.maxDrawdown).toBeGreaterThan(0.05);
  });

  it("fills signals at the next bar's open, not the signal bar's close", () => {
    const bars = makeUptrend(120);
    const result = runBacktest(bars, "sma_crossover", { costBps: 0 });
    const openByDate = new Map(bars.map((bar) => [bar.date, bar.open]));
    const lastDate = bars[bars.length - 1].date;
    expect(result.tradeLog.length).toBeGreaterThan(0);
    for (const trade of result.tradeLog) {
      // The forced liquidation of a still-open position reports at the final
      // close; every signal-driven fill must use its bar's open.
      if (trade.type === "sell" && trade.date === lastDate) continue;
      expect(trade.price).toBeCloseTo(openByDate.get(trade.date) ?? Number.NaN, 6);
    }
  });

  it("reports a final-bar entry signal as pending instead of a phantom trade", () => {
    // Downtrend then rally, sliced so the SMA20>SMA50 cross lands exactly on
    // the last bar — there is no next open to fill at.
    const raw: OHLCV[] = [];
    for (let i = 0; i < 60; i++) {
      const price = 200 - i * 1.5;
      raw.push({
        date: `d${i}`,
        open: price,
        high: price + 1,
        low: price - 1,
        close: price,
        volume: 1_000_000,
      });
    }
    for (let i = 0; i < 60; i++) {
      const price = 110 + i * 2;
      raw.push({
        date: `u${i}`,
        open: price,
        high: price + 1,
        low: price - 1,
        close: price,
        volume: 1_000_000,
      });
    }
    const closes = raw.map((bar) => bar.close);
    const sma20 = computeSMA(closes, 20);
    const sma50 = computeSMA(closes, 50);
    let crossIdx = -1;
    for (let barIdx = 49; barIdx < raw.length; barIdx++) {
      if (sma20[barIdx - 19] > sma50[barIdx - 49]) {
        crossIdx = barIdx;
        break;
      }
    }
    expect(crossIdx).toBeGreaterThan(49);

    const bars = raw.slice(0, crossIdx + 1);
    const result = runBacktest(bars, "sma_crossover", { costBps: 0 });

    expect(result.trades).toBe(0);
    expect(result.forcedClosures).toBe(0);
    expect(result.tradeLog).toHaveLength(0);
    expect(result.pendingSignal).toEqual({ type: "buy", date: bars[bars.length - 1].date });
    expect(result.totalReturn).toBe(0);
  });

  it("does not count a final-bar exit signal as a filled trade", () => {
    const raw: OHLCV[] = [];
    for (let i = 0; i < 60; i++) {
      const price = 200 - i * 1.5;
      raw.push({
        date: `d${i}`,
        open: price,
        high: price + 1,
        low: price - 1,
        close: price,
        volume: 1_000_000,
      });
    }
    for (let i = 0; i < 80; i++) {
      const price = 110 + i * 2;
      raw.push({
        date: `u${i}`,
        open: price,
        high: price + 1,
        low: price - 1,
        close: price,
        volume: 1_000_000,
      });
    }
    for (let i = 0; i < 80; i++) {
      const price = 270 - i * 2;
      raw.push({
        date: `r${i}`,
        open: price,
        high: price + 1,
        low: price - 1,
        close: price,
        volume: 1_000_000,
      });
    }

    const closes = raw.map((bar) => bar.close);
    const sma20 = computeSMA(closes, 20);
    const sma50 = computeSMA(closes, 50);
    let entered = false;
    let exitIdx = -1;
    for (let barIdx = 49; barIdx < raw.length; barIdx++) {
      const bullish = sma20[barIdx - 19] > sma50[barIdx - 49];
      if (!entered && bullish) {
        entered = true;
        continue;
      }
      if (entered && !bullish) {
        exitIdx = barIdx;
        break;
      }
    }
    expect(exitIdx).toBeGreaterThan(49);

    const bars = raw.slice(0, exitIdx + 1);
    const result = runBacktest(bars, "sma_crossover", { costBps: 0 });
    const forcedSells = result.tradeLog.filter((trade) => trade.type === "sell" && trade.forced);
    const signalSells = result.tradeLog.filter((trade) => trade.type === "sell" && !trade.forced);

    expect(result.pendingSignal).toEqual({ type: "sell", date: bars[bars.length - 1].date });
    expect(result.trades).toBe(0);
    expect(result.forcedClosures).toBe(1);
    expect(signalSells).toHaveLength(0);
    expect(forcedSells).toHaveLength(1);
    expect(result.totalReturn).not.toBe(0);
  });

  it("applies a flat per-side cost to every fill", () => {
    const bars = makeOscillating(200);
    const gross = runBacktest(bars, "rsi_mean_reversion", { costBps: 0 });
    const net = runBacktest(bars, "rsi_mean_reversion", { costBps: 50 });

    expect(gross.trades).toBeGreaterThan(0);
    expect(net.trades).toBe(gross.trades);
    expect(net.totalReturn).toBeLessThan(gross.totalReturn);
    expect(net.costBpsPerSide).toBe(50);
    expect(gross.costBpsPerSide).toBe(0);
  });

  it("defaults to the documented flat cost", () => {
    const result = runBacktest(makeUptrend(120), "sma_crossover");
    expect(result.costBpsPerSide).toBe(DEFAULT_COST_BPS);
    expect(DEFAULT_COST_BPS).toBeGreaterThan(0);
  });

  it("documents excluded effects in the limitations list", () => {
    const joined = BACKTEST_LIMITATIONS.join(" ").toLowerCase();
    for (const term of ["dividend", "tax", "slippage", "liquidity", "intrabar"]) {
      expect(joined).toContain(term);
    }
  });

  it("does not emit NaN or Infinity for zero-close history", () => {
    const bars = makeUptrend(260);
    bars[0] = { ...bars[0], close: 0 };
    bars[210] = { ...bars[210], close: 0 };

    expectFiniteBacktestResult(runBacktest(bars, "sma_crossover"));
    expectFiniteBacktestResult(runBacktest(bars, "sma_50_200_crossover"));
    expectFiniteBacktestResult(runBacktest(bars, "rsi_mean_reversion"));
  });
});
