import { describe, it, expect } from "vitest";
import { computeCorrelation, alignReturnsByDate } from "../../../src/tools/portfolio/correlation.js";
import type { OHLCV } from "../../../src/types/market.js";

describe("computeCorrelation", () => {
  it("returns 1.0 for perfectly correlated data", () => {
    const a = [0.01, 0.02, -0.01, 0.03, -0.02];
    const b = [0.01, 0.02, -0.01, 0.03, -0.02]; // identical
    expect(computeCorrelation(a, b)).toBeCloseTo(1.0, 5);
  });

  it("returns -1.0 for perfectly inversely correlated data", () => {
    const a = [0.01, 0.02, -0.01, 0.03, -0.02];
    const b = [-0.01, -0.02, 0.01, -0.03, 0.02]; // exact opposite
    expect(computeCorrelation(a, b)).toBeCloseTo(-1.0, 5);
  });

  it("returns near 0 for uncorrelated data", () => {
    // Alternating patterns that cancel out
    const a = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
    const b = [0.01, 0.01, -0.01, -0.01, 0.01, 0.01, -0.01, -0.01];
    const r = computeCorrelation(a, b);
    expect(Math.abs(r)).toBeLessThan(0.5);
  });

  it("returns 0 when one series has zero variance", () => {
    const a = [0.01, 0.01, 0.01, 0.01];
    const b = [0.01, 0.02, -0.01, 0.03];
    expect(computeCorrelation(a, b)).toBe(0);
  });

  it("handles arrays of different lengths by using the shorter", () => {
    const a = [0.01, 0.02, -0.01, 0.03, -0.02, 0.01, 0.04];
    const b = [0.01, 0.02, -0.01, 0.03, -0.02];
    const r = computeCorrelation(a, b);
    // Should use first 5 elements, which are identical → 1.0
    expect(r).toBeCloseTo(1.0, 5);
  });

  it("returns a value between -1 and 1", () => {
    const a = [0.05, -0.03, 0.02, 0.01, -0.04, 0.03];
    const b = [0.02, 0.01, -0.02, 0.04, -0.01, 0.02];
    const r = computeCorrelation(a, b);
    expect(r).toBeGreaterThanOrEqual(-1);
    expect(r).toBeLessThanOrEqual(1);
  });
});

describe("alignReturnsByDate", () => {
  function makeBars(dates: string[], basePrice: number = 100): OHLCV[] {
    return dates.map((date, i) => ({
      date,
      open: basePrice + i,
      high: basePrice + i + 1,
      low: basePrice + i - 1,
      close: basePrice + i,
      volume: 1_000_000,
    }));
  }

  it("aligns two series with misaligned dates to common dates only", () => {
    // Symbol A has dates 1-5, Symbol B has dates 2-6 (overlap: 2-5)
    const barsA = makeBars(["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04", "2025-01-05"]);
    const barsB = makeBars(["2025-01-02", "2025-01-03", "2025-01-04", "2025-01-05", "2025-01-06"], 200);

    const result = alignReturnsByDate(
      new Map([["A", barsA], ["B", barsB]]),
      2,
    );

    const returnsA = result.get("A")!;
    const returnsB = result.get("B")!;
    expect(returnsA.length).toBe(returnsB.length);
    // Common dates: 2-5 = 4 dates, returns from 4 dates = 3 returns
    expect(returnsA.length).toBe(3);
  });

  it("handles a gap in one series (e.g., holiday)", () => {
    // Symbol A trades all 5 days, Symbol B misses day 3
    const barsA = makeBars(["2025-01-01", "2025-01-02", "2025-01-03", "2025-01-04", "2025-01-05"]);
    const barsB = makeBars(["2025-01-01", "2025-01-02", "2025-01-04", "2025-01-05"], 200);

    const result = alignReturnsByDate(
      new Map([["A", barsA], ["B", barsB]]),
      2,
    );

    const returnsA = result.get("A")!;
    const returnsB = result.get("B")!;
    expect(returnsA.length).toBe(returnsB.length);
    // Common dates: 1, 2, 4, 5 → 3 returns
    expect(returnsA.length).toBe(3);
  });

  it("throws when overlap is below minimum threshold", () => {
    const barsA = makeBars(["2025-01-01", "2025-01-02", "2025-01-03"]);
    const barsB = makeBars(["2025-01-10", "2025-01-11", "2025-01-12"], 200);

    expect(() =>
      alignReturnsByDate(new Map([["A", barsA], ["B", barsB]]))
    ).toThrow();
  });
});
