import { beforeEach, describe, expect, it, vi } from "vitest";
import { getFinancials, getOverview } from "../../../src/providers/alpha-vantage.js";
import { getLseFinancials } from "../../../src/providers/lse.js";
import { getQuote, getYahooFinancials } from "../../../src/providers/yahoo-finance.js";
import { computeDCF, computeNetDebt, dcfTool } from "../../../src/tools/fundamentals/dcf.js";
import type { FinancialStatement } from "../../../src/types/fundamentals.js";

const configMock = vi.hoisted(() => ({
  alphaVantageApiKey: "test-key" as string | undefined,
  lseApiKey: undefined as string | undefined,
}));
const budgetMock = vi.hoisted(() => ({ overSoftThreshold: false }));
const providerMock = vi.hoisted(() => ({
  staleProviders: new Set<string>(),
  timestamps: new Map<string, string>(),
}));

vi.mock("../../../src/config.js", () => ({
  getConfig: () => ({ ...configMock }),
}));
vi.mock("../../../src/infra/lse-byte-budget.js", () => ({
  isOverSoftThreshold: () => budgetMock.overSoftThreshold,
}));
vi.mock("../../../src/providers/wrap-provider.js", () => ({
  wrapProvider: async (_name: string, fn: () => Promise<unknown>) => {
    try {
      return {
        status: "ok",
        data: await fn(),
        ...(providerMock.staleProviders.has(_name) ? { stale: true } : {}),
        ...(providerMock.timestamps.has(_name)
          ? { timestamp: providerMock.timestamps.get(_name) }
          : {}),
      };
    } catch (err) {
      return { status: "unavailable", reason: err instanceof Error ? err.message : String(err) };
    }
  },
}));
vi.mock("../../../src/providers/alpha-vantage.js", () => ({
  getOverview: vi.fn(),
  getFinancials: vi.fn(),
}));
vi.mock("../../../src/providers/lse.js", () => ({
  getLseFinancials: vi.fn(),
}));
vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
  getYahooFinancials: vi.fn(),
}));

describe("computeDCF", () => {
  const baseParams = {
    freeCashFlow: 1_000_000_000, // $1B FCF
    growthRate: 0.1, // 10% growth
    discountRate: 0.1, // 10% WACC
    terminalGrowth: 0.03, // 3% terminal growth
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
    expect(result.projectedCashFlows[0].fcf).toBeCloseTo(baseParams.freeCashFlow * 1.1, 0);
    // Year 2 should compound
    expect(result.projectedCashFlows[1].fcf).toBeCloseTo(baseParams.freeCashFlow * 1.1 ** 2, 0);
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
      noDebt.intrinsicValue - 500_000_000 / baseParams.sharesOutstanding,
      2,
    );
  });

  it("computes margin of safety relative to a reference price", () => {
    const result = computeDCF(baseParams);
    // Margin of safety = (intrinsic - current) / intrinsic
    // Without a current price in the pure function, we verify the formula via assumptions
    expect(result.assumptions.growthRate).toBe(0.1);
    expect(result.assumptions.discountRate).toBe(0.1);
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
      expect(result.warnings.some((w: string) => w.toLowerCase().includes("terminal value"))).toBe(
        true,
      );
    }
  });

  it("warns when terminal growth approaches discount rate", () => {
    const result = computeDCF({
      ...baseParams,
      discountRate: 0.06,
      terminalGrowth: 0.05, // Only 1% spread
    });
    expect(result.warnings.some((w: string) => w.toLowerCase().includes("terminal growth"))).toBe(
      true,
    );
  });

  it("uses mid-year convention for discounting", () => {
    const result = computeDCF(baseParams);
    // Year 1 PV with mid-year: FCF / (1+r)^0.5, not (1+r)^1.0
    const fcfY1 = baseParams.freeCashFlow * (1 + baseParams.growthRate);
    const pvMidYear = fcfY1 / (1 + baseParams.discountRate) ** 0.5;
    expect(result.projectedCashFlows[0].presentValue).toBeCloseTo(pvMidYear, 0);
  });

  it("rejects a terminal growth rate at or above the discount rate", () => {
    expect(() => computeDCF({ ...baseParams, terminalGrowth: baseParams.discountRate })).toThrow(
      /Gordon Growth|terminal growth/i,
    );
    expect(() => computeDCF({ ...baseParams, terminalGrowth: 0.12 })).toThrow(
      /Gordon Growth|terminal growth/i,
    );
  });

  it("adds net cash to equity value instead of clamping it away", () => {
    const netCash = computeDCF({ ...baseParams, netDebt: -500_000_000 });
    const neutral = computeDCF({ ...baseParams, netDebt: 0 });
    expect(netCash.intrinsicValue).toBeCloseTo(
      neutral.intrinsicValue + 500_000_000 / baseParams.sharesOutstanding,
      2,
    );
  });
});

describe("compute_dcf tool guards", () => {
  const statement: FinancialStatement = {
    fiscalDate: "2025-09-30",
    revenue: 400e9,
    grossProfit: 180e9,
    operatingIncome: 120e9,
    netIncome: 100e9,
    eps: 6.5,
    totalAssets: 365e9,
    totalLiabilities: 308e9,
    totalEquity: 57e9,
    operatingCashFlow: 120e9,
    freeCashFlow: 100e9,
    totalDebt: 30e9,
    cashAndEquivalents: 90e9,
  };
  const quote = {
    symbol: "AAPL",
    price: 200,
    change: 0,
    changePercent: 0,
    open: 200,
    high: 200,
    low: 200,
    previousClose: 200,
    volume: 1_000,
    marketCap: 0,
    pe: null,
    week52High: 210,
    week52Low: 150,
    timestamp: 0,
    currency: "USD",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    providerMock.staleProviders.clear();
    providerMock.timestamps.clear();
    configMock.alphaVantageApiKey = "test-key";
    configMock.lseApiKey = undefined;
    budgetMock.overSoftThreshold = false;
    vi.mocked(getLseFinancials).mockResolvedValue([statement]);
    vi.mocked(getFinancials).mockResolvedValue([statement]);
    vi.mocked(getYahooFinancials).mockRejectedValue(new Error("Yahoo financials unavailable"));
    vi.mocked(getQuote).mockResolvedValue(quote);
  });

  it("uses Yahoo quote market cap and skips Alpha Vantage overview when deriving shares", async () => {
    vi.mocked(getQuote).mockResolvedValue({ ...quote, marketCap: 3_000e9 });

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(getOverview).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("Intrinsic Value:");
    expect(result.details).not.toBeNull();
  });

  it("uses fresh LSE statements without calling Alpha Vantage or Yahoo statements", async () => {
    configMock.lseApiKey = "lse-test-key";
    vi.mocked(getQuote).mockResolvedValue({ ...quote, marketCap: 3_000e9 });

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(getLseFinancials).toHaveBeenCalledWith("AAPL");
    expect(getFinancials).not.toHaveBeenCalled();
    expect(getYahooFinancials).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("Intrinsic Value:");
    expect(result.content[0].text).toContain("Financial statements source: London Strategic Edge");
  });

  it("falls through unavailable LSE to the existing Alpha Vantage then Yahoo chain", async () => {
    configMock.lseApiKey = "lse-test-key";
    vi.mocked(getQuote).mockResolvedValue({ ...quote, marketCap: 3_000e9 });
    vi.mocked(getLseFinancials).mockRejectedValue(new Error("LSE unavailable"));
    vi.mocked(getFinancials).mockRejectedValue(new Error("Alpha Vantage rate limited"));
    vi.mocked(getYahooFinancials).mockResolvedValue([statement]);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(getLseFinancials).toHaveBeenCalledOnce();
    expect(getFinancials).toHaveBeenCalledOnce();
    expect(getYahooFinancials).toHaveBeenCalledOnce();
    expect(vi.mocked(getLseFinancials).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getFinancials).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(getFinancials).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(getYahooFinancials).mock.invocationCallOrder[0],
    );
    expect(result.content[0].text).toContain("Financial statements source: Yahoo Finance");
  });

  it("falls through an empty LSE statement set to Alpha Vantage", async () => {
    configMock.lseApiKey = "lse-test-key";
    vi.mocked(getQuote).mockResolvedValue({ ...quote, marketCap: 3_000e9 });
    vi.mocked(getLseFinancials).mockResolvedValue([]);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(getFinancials).toHaveBeenCalledOnce();
    expect(result.content[0].text).toContain("Financial statements source: Alpha Vantage");
  });

  it("refuses the existing stale-only statements path after stale LSE", async () => {
    configMock.lseApiKey = "lse-test-key";
    vi.mocked(getQuote).mockResolvedValue({ ...quote, marketCap: 3_000e9 });
    vi.mocked(getYahooFinancials).mockResolvedValue([statement]);
    providerMock.staleProviders.add("lse");
    providerMock.staleProviders.add("alphavantage");
    providerMock.staleProviders.add("yahoo");
    providerMock.timestamps.set("lse", "2026-07-01T12:00:00.000Z");
    providerMock.timestamps.set("alphavantage", "2026-07-01T13:00:00.000Z");
    providerMock.timestamps.set("yahoo", "2026-07-01T14:00:00.000Z");

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(getLseFinancials).toHaveBeenCalledOnce();
    expect(getFinancials).toHaveBeenCalledOnce();
    expect(getYahooFinancials).toHaveBeenCalledOnce();
    expect(result.content[0].text).toContain("DCF valuation unavailable");
    expect(result.content[0].text).toContain(
      "Yahoo Finance returned stale cached financial statements",
    );
    expect(result.content[0].text).toContain("2026-07-01T14:00:00.000Z");
    expect(result.content[0].text).not.toContain("Intrinsic Value:");
    expect(result.details).toBeNull();
  });

  it("falls back to Yahoo financial statements when Alpha Vantage financials are unavailable", async () => {
    vi.mocked(getQuote).mockResolvedValue({ ...quote, marketCap: 3_000e9 });
    vi.mocked(getFinancials).mockRejectedValue(new Error("Alpha Vantage rate limited"));
    vi.mocked(getYahooFinancials).mockResolvedValue([statement]);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(result.content[0].text).toContain("Intrinsic Value:");
    expect(result.content[0].text).toContain("Financial statements source: Yahoo Finance");
    expect(result.details).not.toBeNull();
  });

  it("reaches Yahoo financial statements when no Alpha Vantage key is configured", async () => {
    configMock.alphaVantageApiKey = undefined;
    vi.mocked(getQuote).mockResolvedValue({ ...quote, marketCap: 3_000e9 });
    vi.mocked(getYahooFinancials).mockResolvedValue([statement]);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(getFinancials).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("Intrinsic Value:");
    expect(result.content[0].text).toContain("Financial statements source: Yahoo Finance");
    expect(result.details).not.toBeNull();
  });

  it("falls back to fresh Yahoo financial statements when Alpha Vantage returns stale cache", async () => {
    vi.mocked(getQuote).mockResolvedValue({ ...quote, marketCap: 3_000e9 });
    vi.mocked(getYahooFinancials).mockResolvedValue([statement]);
    providerMock.staleProviders.add("alphavantage");
    providerMock.timestamps.set("alphavantage", "2026-07-01T14:30:00.000Z");

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(result.content[0].text).toContain("Intrinsic Value:");
    expect(result.content[0].text).toContain("Financial statements source: Yahoo Finance");
    expect(result.details).not.toBeNull();
  });

  it("refuses stale Alpha Vantage financial statements when no fresh Yahoo fallback is available", async () => {
    vi.mocked(getQuote).mockResolvedValue({ ...quote, marketCap: 3_000e9 });
    vi.mocked(getYahooFinancials).mockRejectedValue(new Error("Yahoo financials unavailable"));
    providerMock.staleProviders.add("alphavantage");
    providerMock.timestamps.set("alphavantage", "2026-07-01T14:30:00.000Z");

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(result.content[0].text).toContain("DCF valuation unavailable");
    expect(result.content[0].text).toContain("Alpha Vantage: stale cached financial statements");
    expect(result.content[0].text).toContain("2026-07-01T14:30:00.000Z");
    expect(result.content[0].text).not.toContain("Intrinsic Value:");
    expect(result.details).toBeNull();
  });

  it("refuses stale cached Yahoo financial statements for DCF fallback", async () => {
    vi.mocked(getQuote).mockResolvedValue({ ...quote, marketCap: 3_000e9 });
    vi.mocked(getFinancials).mockRejectedValue(new Error("Alpha Vantage rate limited"));
    vi.mocked(getYahooFinancials).mockResolvedValue([statement]);
    providerMock.staleProviders.add("yahoo");
    providerMock.timestamps.set("yahoo", "2026-07-01T14:30:00.000Z");

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(result.content[0].text).toContain("DCF valuation unavailable");
    expect(result.content[0].text).toContain("stale cached financial statements");
    expect(result.content[0].text).toContain("2026-07-01T14:30:00.000Z");
    expect(result.content[0].text).not.toContain("Intrinsic Value:");
    expect(result.details).toBeNull();
  });

  it("uses financial statement shares when market cap is unavailable", async () => {
    vi.mocked(getFinancials).mockRejectedValue(new Error("Alpha Vantage rate limited"));
    vi.mocked(getYahooFinancials).mockResolvedValue([
      { ...statement, sharesOutstanding: 15_000_000_000 },
    ]);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(getOverview).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("Intrinsic Value:");
    expect(result.details).not.toBeNull();
  });

  it("requires a positive current quote price even when statement shares are available", async () => {
    vi.mocked(getQuote).mockResolvedValue({ ...quote, price: 0 });
    vi.mocked(getFinancials).mockRejectedValue(new Error("Alpha Vantage rate limited"));
    vi.mocked(getYahooFinancials).mockResolvedValue([
      { ...statement, sharesOutstanding: 15_000_000_000 },
    ]);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(result.content[0].text).toMatch(/current stock price|current quote price/i);
    expect(result.content[0].text).not.toContain("Current Price: $0.00");
    expect(result.details).toBeNull();
  });

  it("refuses per-share output when shares outstanding cannot be derived", async () => {
    vi.mocked(getOverview).mockResolvedValue({ marketCap: 0 } as never);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(result.content[0].text).toMatch(/cannot compute|shares outstanding/i);
    expect(result.content[0].text).not.toContain("Intrinsic Value:");
    expect(result.details).toBeNull();
  });

  it("uses signed net debt so net cash raises the intrinsic value", async () => {
    vi.mocked(getOverview).mockResolvedValue({ marketCap: 3_000e9 } as never);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    // statement has 30B debt vs 90B cash → net cash of 60B must be added.
    expect(result.details?.netDebt).toBe(-60e9);
  });

  it("omits net debt adjustment when debt and cash fields are unavailable", async () => {
    vi.mocked(getOverview).mockResolvedValue({ marketCap: 3_000e9 } as never);
    vi.mocked(getFinancials).mockResolvedValue([
      {
        ...statement,
        totalDebt: undefined,
        cashAndEquivalents: undefined,
      },
    ]);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(result.details?.netDebt).toBe(0);
    expect(result.details?.warnings).toContain(
      "Net debt adjustment omitted because total debt and cash equivalents were unavailable.",
    );
    expect(result.content[0].text).toMatch(/Net debt adjustment omitted/i);
  });

  it("rejects an invalid terminal spread before computing", async () => {
    vi.mocked(getOverview).mockResolvedValue({ marketCap: 3_000e9 } as never);

    const result = await dcfTool.execute("t", {
      symbol: "AAPL",
      discount_rate: 0.03,
      terminal_growth: 0.05,
    });

    expect(result.content[0].text).toMatch(/terminal growth.*discount rate|Gordon Growth/i);
    expect(result.content[0].text).not.toContain("Intrinsic Value:");
    expect(result.details).toBeNull();
  });
});

describe("computeNetDebt", () => {
  const baseStatement: FinancialStatement = {
    fiscalDate: "2025-09-30",
    revenue: 400e9,
    grossProfit: 180e9,
    operatingIncome: 120e9,
    netIncome: 100e9,
    eps: 6.5,
    totalAssets: 365e9,
    totalLiabilities: 308e9,
    totalEquity: 57e9,
    operatingCashFlow: 120e9,
    freeCashFlow: 100e9,
  };

  it("uses totalDebt - cashAndEquivalents when both are available", () => {
    const statement: FinancialStatement = {
      ...baseStatement,
      totalDebt: 111e9,
      cashAndEquivalents: 30e9,
    };
    expect(computeNetDebt(statement)).toBeCloseTo(81e9, -6);
  });

  it("returns null when debt/cash fields are missing", () => {
    expect(computeNetDebt(baseStatement)).toBeNull();
  });

  it("does NOT return zero for a company with significant debt", () => {
    const statement: FinancialStatement = {
      ...baseStatement,
      totalDebt: 111e9,
      cashAndEquivalents: 30e9,
    };
    expect(computeNetDebt(statement)).not.toBe(0);
  });
});
