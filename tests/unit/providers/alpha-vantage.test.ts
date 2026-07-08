import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import {
  getDailyHistory,
  getEarnings,
  getFinancials,
  getGlobalQuote,
  getOverview,
} from "../../../src/providers/alpha-vantage.js";
import balanceFixture from "../../fixtures/alphavantage/AAPL-balance-sheet.json";
import cashFlowFixture from "../../fixtures/alphavantage/AAPL-cash-flow.json";
import globalQuoteFixture from "../../fixtures/alphavantage/AAPL-global-quote.json";
import incomeFixture from "../../fixtures/alphavantage/AAPL-income-statement.json";
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
      const _statements = await getFinancials("AAPL", "test-key");

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

    it("throws on Alpha Vantage rate-limit payloads instead of returning empty financials", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            Note: "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute.",
          }),
      });

      await expect(getFinancials("AAPL", "test-key")).rejects.toThrow("Alpha Vantage rate limited");
    });
  });

  describe("getEarnings", () => {
    it("throws on Alpha Vantage information payloads instead of returning empty earnings", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            Information:
              "Thank you for using Alpha Vantage! Our standard API call frequency is 5 calls per minute.",
          }),
      });

      await expect(getEarnings("AAPL", "test-key")).rejects.toThrow("Alpha Vantage rate limited");
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
      expect(quote.asOf).toBe("2026-04-03");
    });

    it("preserves GLOBAL_QUOTE latest trading day as a date-only as-of value", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            "Global Quote": {
              "01. symbol": "AAPL",
              "02. open": "190.00",
              "03. high": "192.00",
              "04. low": "189.00",
              "05. price": "191.00",
              "06. volume": "1000",
              "07. latest trading day": "2026-07-02",
              "08. previous close": "188.00",
              "09. change": "3.00",
              "10. change percent": "1.59%",
            },
          }),
      });

      const quote = await getGlobalQuote("AAPL", "test-key");

      expect(quote.asOf).toBe("2026-07-02");
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

    it("returns only current-year bars for ytd ranges", async () => {
      const bar = (close: string) => ({
        "1. open": close,
        "2. high": close,
        "3. low": close,
        "4. close": close,
        "5. volume": "1000",
      });
      const currentYear = new Date().getFullYear();
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            "Time Series (Daily)": {
              [`${currentYear - 1}-12-30`]: bar("100"),
              [`${currentYear - 1}-12-31`]: bar("101"),
              [`${currentYear}-01-02`]: bar("102"),
              [`${currentYear}-01-05`]: bar("103"),
            },
          }),
      });

      const bars = await getDailyHistory("YTDTEST", "test-key", "ytd");
      expect(bars.map((b) => b.date)).toEqual([`${currentYear}-01-02`, `${currentYear}-01-05`]);
    });

    it("requests full daily history for 10y fallback ranges", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(dailyHistoryFixture),
      });

      await getDailyHistory("AAPL", "test-key", "10y");

      const url = (globalThis.fetch as any).mock.calls[0][0] as string;
      expect(url).toContain("function=TIME_SERIES_DAILY");
      expect(url).toContain("outputsize=full");
    });
  });

  describe("getOverview", () => {
    it("does not map a price field to avgVolume", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
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
      expect(overview.avgVolume).not.toBe(180.5);
    });
  });

  describe("credential errors", () => {
    it("throws ProviderCredentialError with reason=stale on 401 from getOverview", async () => {
      const { ProviderCredentialError } = await import(
        "../../../src/providers/provider-credential-error.js"
      );
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: () => Promise.resolve("Unauthorized"),
      });

      try {
        await getOverview("AAPL", "bad-key");
        throw new Error("expected ProviderCredentialError to be thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(ProviderCredentialError);
        const credErr = err as InstanceType<typeof ProviderCredentialError>;
        expect(credErr.provider).toBe("alpha_vantage");
        expect(credErr.reason).toBe("stale");
        expect(credErr.httpStatus).toBe(401);
      }
    });

    it("throws ProviderCredentialError with reason=stale on 403 from getFinancials", async () => {
      const { ProviderCredentialError } = await import(
        "../../../src/providers/provider-credential-error.js"
      );
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: "Forbidden",
        text: () => Promise.resolve("Forbidden"),
      });

      await expect(getFinancials("NVDA", "bad-key")).rejects.toBeInstanceOf(
        ProviderCredentialError,
      );
    });

    it("still throws generic errors for non-auth failures", async () => {
      const { ProviderCredentialError } = await import(
        "../../../src/providers/provider-credential-error.js"
      );
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: () => Promise.resolve("Internal Server Error"),
      });

      try {
        await getOverview("AAPL", "test-key");
        throw new Error("expected an error to be thrown");
      } catch (err) {
        // Must NOT be ProviderCredentialError — a 500 is not a credential issue.
        expect(err).not.toBeInstanceOf(ProviderCredentialError);
      }
    });
  });
});
