import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFinancials, getOverview, getGlobalQuote, getDailyHistory } from "../../../src/providers/alpha-vantage.js";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import incomeFixture from "../../fixtures/alphavantage/AAPL-income-statement.json";
import balanceFixture from "../../fixtures/alphavantage/AAPL-balance-sheet.json";
import cashFlowFixture from "../../fixtures/alphavantage/AAPL-cash-flow.json";
import globalQuoteFixture from "../../fixtures/alphavantage/AAPL-global-quote.json";
import dailyHistoryFixture from "../../fixtures/alphavantage/AAPL-time-series-daily.json";

describe("alpha-vantage provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    // Reset rate limiter tokens so tests don't block each other
    rateLimiter.configure("alphavantage", 5, 0.083);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("getFinancials", () => {
    function mockThreeStatements() {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("INCOME_STATEMENT")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(incomeFixture) });
        }
        if (url.includes("BALANCE_SHEET")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(balanceFixture) });
        }
        if (url.includes("CASH_FLOW")) {
          return Promise.resolve({ ok: true, json: () => Promise.resolve(cashFlowFixture) });
        }
        return Promise.reject(new Error(`Unexpected URL: ${url}`));
      });
    }

    it("fetches income statement, balance sheet, and cash flow", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      expect(globalThis.fetch).toHaveBeenCalledTimes(3);

      const urls = (globalThis.fetch as any).mock.calls.map((c: any) => c[0]);
      expect(urls.some((u: string) => u.includes("INCOME_STATEMENT"))).toBe(true);
      expect(urls.some((u: string) => u.includes("BALANCE_SHEET"))).toBe(true);
      expect(urls.some((u: string) => u.includes("CASH_FLOW"))).toBe(true);
    });

    it("merges balance sheet data into financial statements", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      expect(statements[0].totalAssets).toBe(364980000000);
      expect(statements[0].totalLiabilities).toBe(308030000000);
      expect(statements[0].totalEquity).toBe(56950000000);
    });

    it("merges cash flow data into financial statements", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      expect(statements[0].operatingCashFlow).toBe(118254000000);
      // freeCashFlow = operatingCashflow - capitalExpenditures
      expect(statements[0].freeCashFlow).toBe(118254000000 - 9959000000);
    });

    it("still includes income statement data", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      expect(statements[0].fiscalDate).toBe("2024-09-30");
      expect(statements[0].revenue).toBe(391035000000);
      expect(statements[0].netIncome).toBe(93736000000);
    });

    it("matches data across statements by fiscal date", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      // Second statement should have 2023 data
      expect(statements[1].fiscalDate).toBe("2023-09-30");
      expect(statements[1].totalAssets).toBe(352583000000);
      expect(statements[1].operatingCashFlow).toBe(110543000000);
    });

    it("uses cached result on second call", async () => {
      mockThreeStatements();
      await getFinancials("AAPL", "test-key");
      await getFinancials("AAPL", "test-key");

      // Should only fetch once (3 calls), second call uses cache
      expect(globalThis.fetch).toHaveBeenCalledTimes(3);
    });

    it("parses totalDebt and cashAndEquivalents from balance sheet", async () => {
      mockThreeStatements();
      const statements = await getFinancials("AAPL", "test-key");

      expect(statements[0].totalDebt).toBe(111088000000);
      expect(statements[0].cashAndEquivalents).toBe(29943000000);
    });
  });

  describe("getGlobalQuote", () => {
    it("maps GLOBAL_QUOTE response to StockQuote", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(globalQuoteFixture),
      });

      const quote = await getGlobalQuote("AAPL", "test-key");
      expect(quote.symbol).toBe("AAPL");
      expect(quote.price).toBe(186.35);
      expect(quote.change).toBe(1.35);
      expect(quote.changePercent).toBeCloseTo(0.7297);
      expect(quote.open).toBe(185.5);
      expect(quote.high).toBe(187.2);
      expect(quote.low).toBe(184.8);
      expect(quote.previousClose).toBe(185.0);
      expect(quote.volume).toBe(54321000);
    });

    it("sets zero/null for fields not in GLOBAL_QUOTE", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(globalQuoteFixture),
      });

      const quote = await getGlobalQuote("AAPL", "test-key");
      expect(quote.marketCap).toBe(0);
      expect(quote.pe).toBeNull();
      expect(quote.week52High).toBe(0);
      expect(quote.week52Low).toBe(0);
    });

    it("uses cache on second call", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(globalQuoteFixture),
      });

      await getGlobalQuote("AAPL", "test-key");
      await getGlobalQuote("AAPL", "test-key");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getDailyHistory", () => {
    it("maps TIME_SERIES_DAILY response to OHLCV[]", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(dailyHistoryFixture),
      });

      const bars = await getDailyHistory("AAPL", "test-key", "1mo");
      expect(bars.length).toBe(3);
      // Sorted chronologically
      expect(bars[0].date).toBe("2026-04-01");
      expect(bars[2].date).toBe("2026-04-03");
      expect(bars[2].close).toBe(186.35);
      expect(bars[2].volume).toBe(54321000);
    });

    it("uses cache on second call", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(dailyHistoryFixture),
      });

      await getDailyHistory("AAPL", "test-key", "1mo");
      await getDailyHistory("AAPL", "test-key", "1mo");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getOverview", () => {
    it("does not map a price field to avgVolume", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          Symbol: "AAPL",
          Name: "Apple Inc",
          Description: "Apple Inc designs and manufactures...",
          Exchange: "NASDAQ",
          Sector: "Technology",
          Industry: "Consumer Electronics",
          MarketCapitalization: "3000000000000",
          PERatio: "30",
          ForwardPE: "28",
          EPS: "6.50",
          DividendYield: "0.005",
          Beta: "1.25",
          "52WeekHigh": "200",
          "52WeekLow": "150",
          "50DayMovingAverage": "180.50",
          ProfitMargin: "0.25",
          QuarterlyRevenueGrowthYOY: "0.08",
        }),
      });

      const overview = await getOverview("AAPL", "test-key");
      // avgVolume should NOT be 180.50 (the 50DayMovingAverage price)
      expect(overview.avgVolume).not.toBe(180.50);
    });
  });
});
