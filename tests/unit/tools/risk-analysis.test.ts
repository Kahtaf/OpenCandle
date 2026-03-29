import { describe, it, expect } from "vitest";
import {
  computeDailyReturns,
  computeMaxDrawdown,
  computeVaR,
  computeRiskMetrics,
} from "../../../src/tools/portfolio/risk-analysis.js";

describe("computeDailyReturns", () => {
  it("computes percentage returns", () => {
    const returns = computeDailyReturns([100, 110, 105]);
    expect(returns).toHaveLength(2);
    expect(returns[0]).toBeCloseTo(0.1, 5); // +10%
    expect(returns[1]).toBeCloseTo(-0.04545, 4); // -4.5%
  });

  it("returns empty for single price", () => {
    expect(computeDailyReturns([100])).toHaveLength(0);
  });
});

describe("computeMaxDrawdown", () => {
  it("computes max drawdown from peak", () => {
    // Peak at 200, drops to 100 = 50% drawdown
    const prices = [100, 150, 200, 150, 100, 120];
    const dd = computeMaxDrawdown(prices);
    expect(dd).toBeCloseTo(0.5, 5); // 50%
  });

  it("returns 0 for strictly ascending prices", () => {
    const prices = [100, 110, 120, 130, 140];
    expect(computeMaxDrawdown(prices)).toBe(0);
  });

  it("handles single price", () => {
    expect(computeMaxDrawdown([100])).toBe(0);
  });
});

describe("computeVaR", () => {
  it("returns value at specified confidence level", () => {
    // 20 returns, 5% confidence = index 1 (sorted ascending)
    const returns = Array.from({ length: 20 }, (_, i) => (i - 10) / 100);
    // sorted: -0.10, -0.09, ..., 0.09
    const var95 = computeVaR(returns, 0.05);
    expect(var95).toBeCloseTo(0.09, 2); // abs of returns[1] = -0.09
  });
});

describe("computeRiskMetrics", () => {
  it("produces complete risk metrics", () => {
    // Generate a realistic-ish price series
    const prices: number[] = [100];
    for (let i = 1; i < 252; i++) {
      prices.push(prices[i - 1] * (1 + (Math.random() - 0.48) * 0.02));
    }

    const metrics = computeRiskMetrics("TEST", prices);
    expect(metrics.symbol).toBe("TEST");
    expect(typeof metrics.annualizedReturn).toBe("number");
    expect(typeof metrics.annualizedVolatility).toBe("number");
    expect(typeof metrics.sharpeRatio).toBe("number");
    expect(metrics.annualizedVolatility).toBeGreaterThan(0);
    expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
    expect(metrics.maxDrawdown).toBeLessThanOrEqual(1);
    expect(metrics.var95).toBeGreaterThanOrEqual(0);
  });

  it("ascending prices give positive annualized return", () => {
    const prices = Array.from({ length: 252 }, (_, i) => 100 + i * 0.5);
    const metrics = computeRiskMetrics("UP", prices);
    expect(metrics.annualizedReturn).toBeGreaterThan(0);
    expect(metrics.sharpeRatio).toBeGreaterThan(0);
  });

  it("descending prices give negative annualized return", () => {
    const prices = Array.from({ length: 252 }, (_, i) => 200 - i * 0.5);
    const metrics = computeRiskMetrics("DOWN", prices);
    expect(metrics.annualizedReturn).toBeLessThan(0);
  });
});
