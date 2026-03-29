import { describe, it, expect } from "vitest";
import { computeComps } from "../../../src/tools/fundamentals/comps.js";
import type { CompanyOverview } from "../../../src/types/fundamentals.js";

function makeOverview(overrides: Partial<CompanyOverview> & { symbol: string }): CompanyOverview {
  return {
    name: overrides.symbol + " Inc",
    description: "Test company",
    exchange: "NASDAQ",
    sector: "Technology",
    industry: "Software",
    marketCap: 1_000_000_000,
    pe: 20,
    forwardPe: 18,
    eps: 5,
    dividendYield: 0.01,
    beta: 1.0,
    week52High: 200,
    week52Low: 100,
    avgVolume: 1_000_000,
    profitMargin: 0.25,
    revenueGrowth: 0.10,
    ...overrides,
  };
}

describe("computeComps", () => {
  const companies = [
    makeOverview({ symbol: "AAPL", pe: 25, profitMargin: 0.30, marketCap: 3_000_000_000_000 }),
    makeOverview({ symbol: "MSFT", pe: 30, profitMargin: 0.35, marketCap: 2_800_000_000_000 }),
    makeOverview({ symbol: "GOOGL", pe: 22, profitMargin: 0.25, marketCap: 2_000_000_000_000 }),
  ];

  it("returns metrics for all companies", () => {
    const result = computeComps(companies);
    expect(result.companies).toHaveLength(3);
    expect(result.metrics.length).toBeGreaterThan(0);
  });

  it("includes P/E in metrics with correct values", () => {
    const result = computeComps(companies);
    const peMetric = result.metrics.find((m) => m.metric === "P/E");
    expect(peMetric).toBeDefined();
    expect(peMetric!.values["AAPL"]).toBe(25);
    expect(peMetric!.values["MSFT"]).toBe(30);
    expect(peMetric!.values["GOOGL"]).toBe(22);
  });

  it("identifies cheapest and most expensive for P/E", () => {
    const result = computeComps(companies);
    const peMetric = result.metrics.find((m) => m.metric === "P/E");
    // Lower P/E is "best" (cheapest), higher is "worst" (most expensive)
    expect(peMetric!.best).toBe("GOOGL");
    expect(peMetric!.worst).toBe("MSFT");
  });

  it("computes median correctly", () => {
    const result = computeComps(companies);
    const peMetric = result.metrics.find((m) => m.metric === "P/E");
    // Median of [22, 25, 30] = 25
    expect(peMetric!.median).toBe(25);
  });

  it("handles null values in metrics", () => {
    const withNulls = [
      makeOverview({ symbol: "AAPL", pe: 25 }),
      makeOverview({ symbol: "MSFT", pe: null }),
      makeOverview({ symbol: "GOOGL", pe: 22 }),
    ];
    const result = computeComps(withNulls);
    const peMetric = result.metrics.find((m) => m.metric === "P/E");
    expect(peMetric!.values["MSFT"]).toBeNull();
    // Median should only use non-null values: [22, 25] → 23.5
    expect(peMetric!.median).toBe(23.5);
  });

  it("includes profit margin metric", () => {
    const result = computeComps(companies);
    const marginMetric = result.metrics.find((m) => m.metric === "Profit Margin");
    expect(marginMetric).toBeDefined();
    expect(marginMetric!.values["MSFT"]).toBe(0.35);
  });

  it("includes 25th and 75th percentiles", () => {
    const fiveCompanies = [
      makeOverview({ symbol: "A", pe: 10 }),
      makeOverview({ symbol: "B", pe: 15 }),
      makeOverview({ symbol: "C", pe: 20 }),
      makeOverview({ symbol: "D", pe: 25 }),
      makeOverview({ symbol: "E", pe: 30 }),
    ];
    const result = computeComps(fiveCompanies);
    const peMetric = result.metrics.find((m) => m.metric === "P/E");
    expect(peMetric).toHaveProperty("p25");
    expect(peMetric).toHaveProperty("p75");
    expect(peMetric!.p25).toBeLessThanOrEqual(peMetric!.median!);
    expect(peMetric!.p75).toBeGreaterThanOrEqual(peMetric!.median!);
  });
});
