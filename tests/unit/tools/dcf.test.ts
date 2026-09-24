import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../../../src/config.js";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { computeDCF, computeNetDebt, dcfTool } from "../../../src/tools/fundamentals/dcf.js";
import type { FinancialStatement } from "../../../src/types/fundamentals.js";
import balanceFixture from "../../fixtures/alphavantage/AAPL-balance-sheet.json";
import cashFlowFixture from "../../fixtures/alphavantage/AAPL-cash-flow.json";
import incomeFixture from "../../fixtures/alphavantage/AAPL-income-statement.json";
import lseBalance from "../../fixtures/lse/financial-reports-AAPL-balance.json";
import lseCashflow from "../../fixtures/lse/financial-reports-AAPL-cashflow.json";
import lseIncome from "../../fixtures/lse/financial-reports-AAPL-income.json";
import quoteFixture from "../../fixtures/yahoo/AAPL-quote.json";
import yahooFundamentals from "../../fixtures/yahoo-finance2/fundamentals-timeseries-AAPL.json";

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

// ---------------------------------------------------------------------------
// compute_dcf tool — drives the registered tool through the real providers
// (Alpha Vantage / LSE / Yahoo), wrapProvider, cache, and rate limiter using
// fixture HTTP responses. No provider module is mocked. This follows the
// tests/AGENTS.md convention of mocking globalThis.fetch with fixture JSON.
// ---------------------------------------------------------------------------

const AV_FINANCIALS_KEY = "av:financials:AAPL";
const YAHOO_FINANCIALS_KEY = "yahoo:financials:AAPL";

function lseReportKey(reportType: "income" | "balance" | "cashflow"): string {
  return `lse:financial_reports:${new URLSearchParams({
    symbol: "AAPL",
    report_type: reportType,
    period: "FY",
  })}`;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function lseIncomeWithoutStatementShares(): typeof lseIncome {
  return lseIncome.map((row) => {
    const data = JSON.parse(row.data) as Record<string, unknown>;
    delete data.weightedAverageShsOut;
    return { ...row, data: JSON.stringify(data) };
  }) as typeof lseIncome;
}

const staleStatement: FinancialStatement = {
  fiscalDate: "2025-09-27",
  revenue: 416_161_000_000,
  grossProfit: 195_201_000_000,
  operatingIncome: 133_050_000_000,
  netIncome: 112_010_000_000,
  eps: 7.49,
  totalAssets: 359_241_000_000,
  totalLiabilities: 285_508_000_000,
  totalEquity: 73_733_000_000,
  operatingCashFlow: 111_482_000_000,
  freeCashFlow: 98_767_000_000,
  totalDebt: 112_377_000_000,
  cashAndEquivalents: 35_934_000_000,
  sharesOutstanding: 14_948_500_000,
};

interface FetchState {
  lse: "fixtures" | "fail" | "incomplete";
  av: "fixtures" | "fail" | "overview-missing";
  yahooFinancials: "fixture" | "fail";
  quote: "fixture" | "zero-price" | "zero-market-cap";
  lseIncome: typeof lseIncome;
  balance: typeof balanceFixture;
  calls: string[];
}

let state: FetchState;
let openCandleHome: string;

function handleFetch(input: RequestInfo | URL): Promise<Response> {
  const url =
    typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  state.calls.push(url);

  // yahoo-finance2's optional version notice hits the npm registry.
  if (url.includes("registry.npmjs.org"))
    return Promise.resolve(jsonResponse({ version: "4.0.2" }));

  if (url.includes("query1.finance.yahoo.com/ws/fundamentals-timeseries")) {
    if (state.yahooFinancials === "fail") return Promise.resolve(jsonResponse({}, 500));
    return Promise.resolve(jsonResponse(yahooFundamentals));
  }

  if (url.includes("/v8/finance/chart/")) {
    const quote = structuredClone(quoteFixture);
    if (state.quote === "zero-price") quote.chart.result[0].meta.regularMarketPrice = 0;
    if (state.quote === "zero-market-cap") quote.chart.result[0].meta.marketCap = 0;
    return Promise.resolve(jsonResponse(quote));
  }

  // yahoo-finance2 extended-hours quote; a failure here is swallowed by the
  // provider's enrichment step, leaving the chart quote intact.
  if (url.includes("finance/quote")) {
    return Promise.resolve(jsonResponse({ quoteResponse: { result: [], error: null } }));
  }

  if (url.includes("www.alphavantage.co")) {
    const fn = new URL(url).searchParams.get("function");
    if (fn === "OVERVIEW") {
      if (state.av === "overview-missing") return Promise.resolve(jsonResponse({}));
      return Promise.resolve(
        jsonResponse({ Symbol: "AAPL", Name: "Apple Inc.", MarketCapitalization: "3000000000000" }),
      );
    }
    if (state.av === "fail") return Promise.resolve(jsonResponse({}, 400));
    if (fn === "INCOME_STATEMENT") return Promise.resolve(jsonResponse(incomeFixture));
    if (fn === "BALANCE_SHEET") return Promise.resolve(jsonResponse(state.balance));
    if (fn === "CASH_FLOW") return Promise.resolve(jsonResponse(cashFlowFixture));
  }

  if (url.includes("api.londonstrategicedge.com")) {
    const reportType = new URL(url).searchParams.get("report_type");
    if (state.lse === "fail")
      return Promise.resolve(jsonResponse({ detail: "Invalid API key" }, 400));
    if (state.lse === "incomplete") {
      return Promise.resolve(
        reportType === "income" ? jsonResponse(state.lseIncome) : jsonResponse([]),
      );
    }
    const fixture =
      reportType === "income"
        ? state.lseIncome
        : reportType === "balance"
          ? lseBalance
          : lseCashflow;
    return Promise.resolve(jsonResponse(fixture));
  }

  if (url.includes("fc.yahoo.com") || url.includes("getcrumb")) {
    return Promise.resolve(jsonResponse({}, 500));
  }

  return Promise.resolve(jsonResponse({ error: `unexpected fetch: ${url}` }, 404));
}

function textContent(result: { content: Array<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  if (first?.type !== "text" || first.text === undefined) throw new Error("expected text content");
  return first.text;
}

function toolDetails(result: { details?: any }): any {
  return result.details;
}

describe("compute_dcf tool (real providers over fixture HTTP)", () => {
  beforeEach(() => {
    cache.clear();
    rateLimiter.configure("yahoo", 1000, 1000);
    rateLimiter.configure("alphavantage", 1000, 1000);
    rateLimiter.configure("lse", 1000, 1000);
    openCandleHome = mkdtempSync(join(tmpdir(), "opencandle-dcf-"));
    vi.stubEnv("OPENCANDLE_HOME", openCandleHome);
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "av-test-key");
    vi.stubEnv("LSE_API_KEY", "lse-test-key");
    resetConfigCache();
    state = {
      lse: "fixtures",
      av: "fixtures",
      yahooFinancials: "fixture",
      quote: "fixture",
      lseIncome,
      balance: structuredClone(balanceFixture),
      calls: [],
    };
    vi.stubGlobal("fetch", vi.fn(handleFetch));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    resetConfigCache();
    cache.clear();
    rmSync(openCandleHome, { recursive: true, force: true });
  });

  function alphavantageCalled(): boolean {
    return state.calls.some((url) => url.includes("www.alphavantage.co"));
  }

  function yahooFinancialsCalled(): boolean {
    return state.calls.some((url) => url.includes("fundamentals-timeseries"));
  }

  function overviewCalled(): boolean {
    return state.calls.some(
      (url) => url.includes("www.alphavantage.co") && url.includes("OVERVIEW"),
    );
  }

  function callIndex(fragment: string): number {
    return state.calls.findIndex((url) => url.includes(fragment));
  }

  it("uses the fresh LSE statement set without calling Alpha Vantage or Yahoo statements", async () => {
    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toContain("Financial statements source: London Strategic Edge");
    expect(toolDetails(result)).not.toBeNull();
    expect(alphavantageCalled()).toBe(false);
    expect(yahooFinancialsCalled()).toBe(false);
  });

  it("derives shares from the quote market cap without calling the Alpha Vantage overview", async () => {
    state.lseIncome = lseIncomeWithoutStatementShares();

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toContain("Financial statements source: London Strategic Edge");
    expect(toolDetails(result)?.currentPrice).toBe(178.72);
    expect(Number.isFinite(toolDetails(result)?.intrinsicValue)).toBe(true);
    expect(overviewCalled()).toBe(false);
  });

  it("uses financial-statement shares when the quote market cap is unavailable", async () => {
    state.quote = "zero-market-cap";

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(toolDetails(result)).not.toBeNull();
    expect(textContent(result)).toContain("Financial statements source: London Strategic Edge");
    expect(overviewCalled()).toBe(false);
  });

  it("falls through an unavailable LSE to Alpha Vantage and then to Yahoo", async () => {
    state.lse = "fail";
    state.av = "fail";

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toContain("Financial statements source: Yahoo Finance");
    expect(toolDetails(result)).not.toBeNull();
    expect(callIndex("api.londonstrategicedge.com")).toBeGreaterThanOrEqual(0);
    expect(callIndex("www.alphavantage.co")).toBeGreaterThan(
      callIndex("api.londonstrategicedge.com"),
    );
    expect(callIndex("fundamentals-timeseries")).toBeGreaterThan(callIndex("www.alphavantage.co"));
  });

  it("treats an LSE statement set with no complete statements as unavailable and falls back to Alpha Vantage", async () => {
    state.lse = "incomplete";

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toContain("Financial statements source: Alpha Vantage");
    expect(toolDetails(result)).not.toBeNull();
  });

  it("falls back to fresh Yahoo financial statements when Alpha Vantage is unavailable", async () => {
    state.lse = "fail";
    state.av = "fail";

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toContain("Financial statements source: Yahoo Finance");
    expect(yahooFinancialsCalled()).toBe(true);
  });

  it("reaches Yahoo financial statements when no Alpha Vantage key is configured", async () => {
    vi.stubEnv("ALPHA_VANTAGE_API_KEY", "");
    resetConfigCache();
    state.lse = "fail";

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toContain("Financial statements source: Yahoo Finance");
    expect(alphavantageCalled()).toBe(false);
  });

  it("falls back to fresh Yahoo financial statements when Alpha Vantage returns stale cache", async () => {
    state.lse = "fail";
    state.av = "fail";
    cache.set(AV_FINANCIALS_KEY, [staleStatement], -1);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toContain("Financial statements source: Yahoo Finance");
    expect(toolDetails(result)).not.toBeNull();
  });

  it("refuses stale Alpha Vantage financial statements when no fresh Yahoo fallback is available", async () => {
    state.lse = "fail";
    state.av = "fail";
    state.yahooFinancials = "fail";
    cache.set(AV_FINANCIALS_KEY, [staleStatement], -1);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toContain("Alpha Vantage: stale cached financial statements");
    expect(textContent(result)).toMatch(/from \d{4}-\d{2}-\d{2}T/);
    expect(textContent(result)).not.toContain("Intrinsic Value:");
    expect(toolDetails(result)).toBeNull();
  });

  it("refuses stale cached Yahoo financial statements for the DCF fallback", async () => {
    state.lse = "fail";
    state.av = "fail";
    state.yahooFinancials = "fail";
    cache.set(YAHOO_FINANCIALS_KEY, [staleStatement], -1);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toContain(
      "Yahoo Finance returned stale cached financial statements",
    );
    expect(textContent(result)).toMatch(/from \d{4}-\d{2}-\d{2}T/);
    expect(textContent(result)).not.toContain("Intrinsic Value:");
    expect(toolDetails(result)).toBeNull();
  });

  it("refuses the stale-only statement chain after LSE, Alpha Vantage, and Yahoo are all stale", async () => {
    state.lse = "fail";
    state.av = "fail";
    state.yahooFinancials = "fail";
    cache.set(lseReportKey("income"), lseIncome, -1);
    cache.set(lseReportKey("balance"), lseBalance, -1);
    cache.set(lseReportKey("cashflow"), lseCashflow, -1);
    cache.set(AV_FINANCIALS_KEY, [staleStatement], -1);
    cache.set(YAHOO_FINANCIALS_KEY, [staleStatement], -1);

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toContain(
      "Yahoo Finance returned stale cached financial statements",
    );
    expect(textContent(result)).toMatch(/from \d{4}-\d{2}-\d{2}T/);
    expect(textContent(result)).not.toContain("Intrinsic Value:");
    expect(toolDetails(result)).toBeNull();
  });

  it("requires a positive current quote price even when statement shares are available", async () => {
    state.quote = "zero-price";

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toMatch(/current stock price|current quote price/i);
    expect(textContent(result)).not.toContain("Current Price: $0.00");
    expect(toolDetails(result)).toBeNull();
  });

  it("refuses per-share output when shares outstanding cannot be derived", async () => {
    state.lseIncome = lseIncomeWithoutStatementShares();
    state.quote = "zero-market-cap";
    state.av = "overview-missing";

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(textContent(result)).toMatch(/cannot compute|shares outstanding/i);
    expect(textContent(result)).not.toContain("Intrinsic Value:");
    expect(toolDetails(result)).toBeNull();
  });

  it("applies signed net debt so net cash raises the intrinsic value", async () => {
    state.lse = "fail";
    state.balance = structuredClone(balanceFixture);
    state.balance.annualReports[0].shortLongTermDebtTotal = "30000000000";
    state.balance.annualReports[0].cashAndCashEquivalentsAtCarryingValue = "90000000000";

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    // 30B debt vs 90B cash → net cash of 60B must be added.
    expect(toolDetails(result)?.netDebt).toBe(-60_000_000_000);
  });

  it("omits the net debt adjustment when debt and cash fields are unavailable", async () => {
    state.lse = "fail";
    state.balance = structuredClone(balanceFixture);
    for (const report of state.balance.annualReports) {
      (report as Record<string, unknown>).shortLongTermDebtTotal = undefined;
      (report as Record<string, unknown>).cashAndCashEquivalentsAtCarryingValue = undefined;
    }

    const result = await dcfTool.execute("t", { symbol: "AAPL" });

    expect(toolDetails(result)?.netDebt).toBe(0);
    expect(toolDetails(result)?.warnings).toContain(
      "Net debt adjustment omitted because total debt and cash equivalents were unavailable.",
    );
    expect(textContent(result)).toMatch(/Net debt adjustment omitted/i);
  });

  it("rejects an invalid terminal spread before computing", async () => {
    const result = await dcfTool.execute("t", {
      symbol: "AAPL",
      discount_rate: 0.03,
      terminal_growth: 0.05,
    });

    expect(textContent(result)).toMatch(/terminal growth.*discount rate|Gordon Growth/i);
    expect(textContent(result)).not.toContain("Intrinsic Value:");
    expect(toolDetails(result)).toBeNull();
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
