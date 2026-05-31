import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getQuote, getHistory } from "../../../src/providers/yahoo-finance.js";
import { InvalidSymbolError } from "../../../src/providers/errors.js";
import { cache } from "../../../src/infra/cache.js";
import quoteFixture from "../../fixtures/yahoo/AAPL-quote.json";
import historyFixture from "../../fixtures/yahoo/AAPL-history.json";
import invalidQuoteFixture from "../../fixtures/yahoo/XXFAKEXX-quote.json";

describe("yahoo-finance provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
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
      expect(quote.high).toBe(179.50);
      expect(quote.low).toBe(175.82);
      expect(quote.volume).toBe(55123456);
      expect(quote.marketCap).toBe(2780000000000);
      expect(quote.week52High).toBe(199.62);
      expect(quote.week52Low).toBe(143.90);
    });

    it("computes change and changePercent from price and previousClose", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(quoteFixture),
      });

      const quote = await getQuote("AAPL");
      const expectedChange = 178.72 - 175.10;
      const expectedPercent = (expectedChange / 175.10) * 100;
      expect(quote.change).toBeCloseTo(expectedChange, 2);
      expect(quote.changePercent).toBeCloseTo(expectedPercent, 2);
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
        json: () => Promise.resolve({
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
      expect(bars[0].open).toBe(171.00);
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
});
