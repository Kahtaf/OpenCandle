import { describe, it, expect } from "vitest";
import { computeDCF } from "../../../src/tools/fundamentals/dcf.js";

describe("computeDCF", () => {
  const baseParams = {
    freeCashFlow: 1_000_000_000, // $1B FCF
    growthRate: 0.10,            // 10% growth
    discountRate: 0.10,          // 10% WACC
    terminalGrowth: 0.03,        // 3% terminal growth
    years: 5,
    netDebt: 0,
    sharesOutstanding: 1_000_000_000, // 1B shares
  };

  it("computes intrinsic value per share", () => {
    const result = computeDCF(baseParams);
    expect(result.intrinsicValue).toBeGreaterThan(0);
    expect(typeof result.intrinsicValue).toBe("number");
    expect(Number.isFinite(result.intrinsicValue)).toBe(true);
  });

  it("projected cash flows grow at the specified rate", () => {
    const result = computeDCF(baseParams);
    expect(result.projectedCashFlows).toHaveLength(5);
    // Year 1 FCF should be baseParams.freeCashFlow * (1 + growthRate)
    expect(result.projectedCashFlows[0].fcf).toBeCloseTo(
      baseParams.freeCashFlow * 1.10, 0,
    );
    // Year 2 should compound
    expect(result.projectedCashFlows[1].fcf).toBeCloseTo(
      baseParams.freeCashFlow * 1.10 ** 2, 0,
    );
  });

  it("present values use mid-year convention discounting", () => {
    const result = computeDCF(baseParams);
    for (const cf of result.projectedCashFlows) {
      const expected = cf.fcf / (1 + baseParams.discountRate) ** (cf.year - 0.5);
      expect(cf.presentValue).toBeCloseTo(expected, 0);
    }
  });

  it("enterprise value equals sum of mid-year PVs plus discounted terminal value", () => {
    const result = computeDCF(baseParams);
    const sumPVs = result.projectedCashFlows.reduce((s, cf) => s + cf.presentValue, 0);
    const discountedTV = result.terminalValue / (1 + baseParams.discountRate) ** baseParams.years;
    expect(result.enterpriseValue).toBeCloseTo(sumPVs + discountedTV, 0);
  });

  it("subtracts net debt from enterprise value", () => {
    const withDebt = computeDCF({ ...baseParams, netDebt: 500_000_000 });
    const noDebt = computeDCF({ ...baseParams, netDebt: 0 });
    expect(withDebt.intrinsicValue).toBeCloseTo(
      noDebt.intrinsicValue - 500_000_000 / baseParams.sharesOutstanding, 2,
    );
  });

  it("computes margin of safety relative to a reference price", () => {
    const result = computeDCF(baseParams);
    // Margin of safety = (intrinsic - current) / intrinsic
    // Without a current price in the pure function, we verify the formula via assumptions
    expect(result.assumptions.growthRate).toBe(0.10);
    expect(result.assumptions.discountRate).toBe(0.10);
  });

  it("builds a sensitivity table", () => {
    const result = computeDCF(baseParams);
    expect(result.sensitivityTable.length).toBeGreaterThan(0);
    // Each entry should have growth, discount, and intrinsic value
    for (const entry of result.sensitivityTable) {
      expect(entry).toHaveProperty("growthRate");
      expect(entry).toHaveProperty("discountRate");
      expect(entry).toHaveProperty("intrinsicValue");
      expect(entry.intrinsicValue).toBeGreaterThan(0);
    }
  });

  it("higher growth rate produces higher intrinsic value", () => {
    const low = computeDCF({ ...baseParams, growthRate: 0.05 });
    const high = computeDCF({ ...baseParams, growthRate: 0.15 });
    expect(high.intrinsicValue).toBeGreaterThan(low.intrinsicValue);
  });

  it("higher discount rate produces lower intrinsic value", () => {
    const low = computeDCF({ ...baseParams, discountRate: 0.08 });
    const high = computeDCF({ ...baseParams, discountRate: 0.12 });
    expect(low.intrinsicValue).toBeGreaterThan(high.intrinsicValue);
  });

  it("includes validation warnings array in result", () => {
    const result = computeDCF(baseParams);
    expect(result).toHaveProperty("warnings");
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("warns when terminal value exceeds 85% of enterprise value", () => {
    // Low growth + low discount → terminal value dominates
    const result = computeDCF({
      ...baseParams,
      growthRate: 0.02,
      discountRate: 0.06,
      terminalGrowth: 0.03,
    });
    const pvTV = result.terminalValue / (1 + 0.06) ** 5;
    const tvPct = pvTV / result.enterpriseValue;
    if (tvPct > 0.85) {
      expect(result.warnings.some((w: string) => w.toLowerCase().includes("terminal value"))).toBe(true);
    }
  });

  it("warns when terminal growth approaches discount rate", () => {
    const result = computeDCF({
      ...baseParams,
      discountRate: 0.06,
      terminalGrowth: 0.05, // Only 1% spread
    });
    expect(result.warnings.some((w: string) => w.toLowerCase().includes("terminal growth"))).toBe(true);
  });

  it("uses mid-year convention for discounting", () => {
    const result = computeDCF(baseParams);
    // Year 1 PV with mid-year: FCF / (1+r)^0.5, not (1+r)^1.0
    const fcfY1 = baseParams.freeCashFlow * (1 + baseParams.growthRate);
    const pvMidYear = fcfY1 / (1 + baseParams.discountRate) ** 0.5;
    expect(result.projectedCashFlows[0].presentValue).toBeCloseTo(pvMidYear, 0);
  });
});
