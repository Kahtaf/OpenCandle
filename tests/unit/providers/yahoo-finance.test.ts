import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { InvalidSymbolError } from "../../../src/providers/errors.js";
import { getHistory, getQuote, getYahooFinancials } from "../../../src/providers/yahoo-finance.js";
import type { StockQuote } from "../../../src/types/market.js";
import historyFixture from "../../fixtures/yahoo/AAPL-history.json";
import quoteFixture from "../../fixtures/yahoo/AAPL-quote.json";
import weekendStaleQuoteFixture from "../../fixtures/yahoo/weekend-stale-quote.json";
import invalidQuoteFixture from "../../fixtures/yahoo/XXFAKEXX-quote.json";

const yahooFinanceMock = vi.hoisted(() => ({
  fundamentalsTimeSeries: vi.fn(),
}));

vi.mock("yahoo-finance2", () => ({
  default: vi.fn(function YahooFinance() {
    return { fundamentalsTimeSeries: yahooFinanceMock.fundamentalsTimeSeries };
  }),
}));

describe("yahoo-finance provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    rateLimiter.configure("yahoo", 1000, 1000);
    yahooFinanceMock.fundamentalsTimeSeries.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("getQuote", () => {
    it("returns a StockQuote for a valid symbol", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(quoteFixture),
      });

      const quote = await getQuote("AAPL");
      expect(quote.symbol).toBe("AAPL");
      expect(quote.price).toBe(178.72);
      expect(quote.open).toBe(176.15);
      expect(quote.high).toBe(179.5);
      expect(quote.low).toBe(175.82);
      expect(quote.volume).toBe(55123456);
      expect(quote.marketCap).toBe(2780000000000);
      expect(quote.week52High).toBe(199.62);
      expect(quote.week52Low).toBe(143.9);
    });

    it("computes change and changePercent from price and previousClose", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(quoteFixture),
      });

      const quote = await getQuote("AAPL");
      const expectedChange = 178.72 - 175.1;
      const expectedPercent = (expectedChange / 175.1) * 100;
      expect(quote.change).toBeCloseTo(expectedChange, 2);
      expect(quote.changePercent).toBeCloseTo(expectedPercent, 2);
    });

    it("maps Yahoo regularMarketTime to provider asOf without changing fetch timestamp", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(weekendStaleQuoteFixture),
      });

      const before = Date.now();
      const quote = await getQuote("WEEKEND");
      const after = Date.now();

      expect(quote.asOf).toBe("2024-03-22T20:00:00.000Z");
      expect(quote.timestamp).toBeGreaterThanOrEqual(before);
      expect(quote.timestamp).toBeLessThanOrEqual(after);
    });

    it("uses cache on second call", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(quoteFixture),
      });

      await getQuote("AAPL");
      await getQuote("AAPL");
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("throws on API error response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chart: {
              result: null,
              error: { code: "Not Found", description: "No data found" },
            },
          }),
      });

      await expect(getQuote("INVALID")).rejects.toThrow("No data found");
    });

    it("throws InvalidSymbolError for sparse zero-result quote responses", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(invalidQuoteFixture),
      });

      await expect(getQuote("XXFAKEXX")).rejects.toMatchObject({
        symbol: "XXFAKEXX",
        provider: "yahoo",
      });
      await expect(getQuote("XXFAKEXX")).rejects.toBeInstanceOf(InvalidSymbolError);
    });

    it("preserves real low-priced quotes when at least one market field is non-zero", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            chart: {
              result: [
                {
                  meta: {
                    symbol: "PENNY",
                    regularMarketPrice: 0.04,
                    chartPreviousClose: 0.03,
                    regularMarketOpen: 0.03,
                    regularMarketDayHigh: 0.05,
                    regularMarketDayLow: 0.03,
                    regularMarketVolume: 12000,
                    marketCap: 50000,
                    fiftyTwoWeekHigh: 0.2,
                    fiftyTwoWeekLow: 0.01,
                  },
                  timestamp: [],
                  indicators: { quote: [{ open: [], high: [], low: [], close: [], volume: [] }] },
                },
              ],
              error: null,
            },
          }),
      });

      const quote = await getQuote("PENNY");

      expect(quote.price).toBe(0.04);
      expect(quote.volume).toBe(12000);
      expect(quote.marketCap).toBe(50000);
    });

    it("returns stale cached quote promptly when Yahoo 429 sends a long Retry-After", async () => {
      vi.useFakeTimers();
      const staleQuote: StockQuote = {
        symbol: "AAPL",
        price: 171.25,
        change: 1.5,
        changePercent: 0.88,
        open: 170,
        high: 172,
        low: 169,
        previousClose: 169.75,
        volume: 123_456,
        marketCap: 2_700_000_000_000,
        pe: null,
        week52High: 199,
        week52Low: 140,
        timestamp: Date.now(),
        currency: "USD",
      };
      cache.set("yahoo:quote:AAPL", staleQuote, -1);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "60" : null) },
        text: () => Promise.resolve("rate limited"),
      });

      const quotePromise = getQuote("AAPL");

      await vi.advanceTimersByTimeAsync(999);
      expect(fetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(fetch).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(quotePromise).resolves.toEqual(staleQuote);
      expect(fetch).toHaveBeenCalledTimes(3);
    });
  });

  describe("getHistory", () => {
    it("returns OHLCV array for valid symbol", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(historyFixture),
      });

      const bars = await getHistory("AAPL", "5d", "1d");
      expect(bars).toHaveLength(4);
      expect(bars[0].date).toBeDefined();
      expect(bars[0].open).toBe(171.0);
      expect(bars[0].close).toBe(172.28);
      expect(bars[3].close).toBe(178.72);
    });

    it("caches history results", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(historyFixture),
      });

      await getHistory("AAPL", "6mo", "1d");
      await getHistory("AAPL", "6mo", "1d");
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getYahooFinancials", () => {
    it("accepts epoch-second dates from raw Yahoo fundamentals rows", async () => {
      yahooFinanceMock.fundamentalsTimeSeries.mockResolvedValue([
        {
          date: Date.UTC(2024, 5, 30) / 1000,
          totalRevenue: 391_035_000_000,
          grossProfit: 180_683_000_000,
          operatingIncome: 123_216_000_000,
          netIncome: 93_736_000_000,
          freeCashFlow: 108_807_000_000,
          ordinarySharesNumber: 15_343_783_000,
        },
      ]);

      const statements = await getYahooFinancials("aapl");

      expect(statements).toMatchObject([
        {
          fiscalDate: "2024-06-30",
          revenue: 391_035_000_000,
          grossProfit: 180_683_000_000,
          operatingIncome: 123_216_000_000,
          netIncome: 93_736_000_000,
          freeCashFlow: 108_807_000_000,
          sharesOutstanding: 15_343_783_000,
        },
      ]);
    });
  });
});
