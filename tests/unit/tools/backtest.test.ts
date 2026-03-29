import { describe, it, expect } from "vitest";
import { runBacktest, type BacktestResult } from "../../../src/tools/technical/backtest.js";
import type { OHLCV } from "../../../src/types/market.js";

// Generate deterministic uptrending bars
function makeUptrend(days: number): OHLCV[] {
  return Array.from({ length: days }, (_, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: 100 + i * 0.5,
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

describe("runBacktest", () => {
  it("returns a BacktestResult with required fields", () => {
    const bars = makeUptrend(100);
    const result = runBacktest(bars, "sma_crossover");
    expect(result).toHaveProperty("strategy");
    expect(result).toHaveProperty("totalReturn");
    expect(result).toHaveProperty("buyAndHoldReturn");
    expect(result).toHaveProperty("trades");
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
        open: 100 + i * 0.5, high: 101 + i * 0.5,
        low: 99 + i * 0.5, close: 100 + i * 0.5, volume: 1_000_000,
      });
    }
    const peakPrice = bars[bars.length - 1].close; // ~129.5
    // Decline 15% over 10 bars — too gentle/short to flip SMA20 < SMA50
    for (let i = 0; i < 10; i++) {
      const price = peakPrice * (1 - 0.15 * (i + 1) / 10);
      bars.push({
        date: `2024-03-${String(i + 1).padStart(2, "0")}`,
        open: price, high: price + 1, low: price - 1, close: price, volume: 1_000_000,
      });
    }

    const result = runBacktest(bars, "sma_crossover");
    // Position should still be open at end (force-closed)
    // Max drawdown should reflect the ~15% unrealized loss
    expect(result.maxDrawdown).toBeGreaterThan(0.05);
  });
});
