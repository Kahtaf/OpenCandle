import { afterEach, describe, expect, it, vi } from "vitest";
import { getHistory } from "../../../src/providers/yahoo-finance.js";
import {
  alignReturnsByDate,
  computeCorrelation,
  correlationTool,
} from "../../../src/tools/portfolio/correlation.js";
import type { OHLCV } from "../../../src/types/market.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getHistory: vi.fn(),
}));

const mockedGetHistory = vi.mocked(getHistory);

afterEach(() => {
  vi.clearAllMocks();
});

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
    const barsB = makeBars(
      ["2025-01-02", "2025-01-03", "2025-01-04", "2025-01-05", "2025-01-06"],
      200,
    );

    const result = alignReturnsByDate(
      new Map([
        ["A", barsA],
        ["B", barsB],
      ]),
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
      new Map([
        ["A", barsA],
        ["B", barsB],
      ]),
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
      alignReturnsByDate(
        new Map([
          ["A", barsA],
          ["B", barsB],
        ]),
      ),
    ).toThrow();
  });
});

describe("correlationTool", () => {
  function makeBars(symbolOffset: number): OHLCV[] {
    return Array.from({ length: 30 }, (_, i) => ({
      date: `2025-01-${String(i + 1).padStart(2, "0")}`,
      open: 100 + symbolOffset + i,
      high: 101 + symbolOffset + i,
      low: 99 + symbolOffset + i,
      close: 100 + symbolOffset + i,
      volume: 1_000_000,
    }));
  }

  it("computes a matrix over survivors and reports one dropped symbol", async () => {
    mockedGetHistory.mockImplementation(async (symbol: string) => {
      if (symbol === "BAD") throw new Error("Invalid symbol BAD for yahoo");
      return makeBars(symbol === "AAPL" ? 0 : 10);
    });

    const result = await correlationTool.execute("test", {
      symbols: ["AAPL", "BAD", "MSFT"],
      period: "1y",
    });

    expect(result.content[0].text).toContain("Symbols dropped:");
    expect(result.content[0].text).toContain("BAD: Invalid symbol BAD for yahoo");
    expect(result.details.matrix).toHaveProperty("AAPL");
    expect(result.details.matrix).toHaveProperty("MSFT");
    expect(result.details.matrix).not.toHaveProperty("BAD");
  });

  it("returns unavailable when fewer than two symbols have history", async () => {
    mockedGetHistory.mockImplementation(async (symbol: string) => {
      if (symbol === "AAPL") return makeBars(0);
      throw new Error(`Invalid symbol ${symbol} for yahoo`);
    });

    const result = await correlationTool.execute("test", {
      symbols: ["AAPL", "BAD1", "BAD2"],
      period: "1y",
    });

    expect(result.content[0].text).toContain("⚠ Correlation analysis unavailable");
    expect(result.content[0].text).toContain("BAD1: Invalid symbol BAD1 for yahoo");
    expect(result.content[0].text).toContain("BAD2: Invalid symbol BAD2 for yahoo");
    expect(result.details).toBeNull();
  });
});
