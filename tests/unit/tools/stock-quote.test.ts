import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetConfigCache } from "../../../src/config.js";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { stockQuoteTool } from "../../../src/tools/market/stock-quote.js";
import type { StockQuote } from "../../../src/types/market.js";
import globalQuoteFixture from "../../fixtures/alphavantage/AAPL-global-quote.json";
import quoteFixture from "../../fixtures/yahoo/AAPL-quote.json";
import weekendStaleQuoteFixture from "../../fixtures/yahoo/weekend-stale-quote.json";
import invalidQuoteFixture from "../../fixtures/yahoo/XXFAKEXX-quote.json";

describe("get_stock_quote tool", () => {
  const originalFetch = globalThis.fetch;
  const originalAlphaVantageApiKey = process.env.ALPHA_VANTAGE_API_KEY;

  beforeEach(() => {
    cache.clear();
    // Pin the Alpha Vantage key so the fallback branch is covered identically
    // with or without a developer .env / shell key. An empty string is
    // deliberately not `undefined`, which stops `loadEnv()` from refilling it.
    process.env.ALPHA_VANTAGE_API_KEY = "";
    resetConfigCache();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (originalAlphaVantageApiKey == null) {
      delete process.env.ALPHA_VANTAGE_API_KEY;
    } else {
      process.env.ALPHA_VANTAGE_API_KEY = originalAlphaVantageApiKey;
    }
    resetConfigCache();
  });

  it("has correct tool metadata", () => {
    expect(stockQuoteTool.name).toBe("get_stock_quote");
    expect(stockQuoteTool.label).toBe("Stock Quote");
    expect(stockQuoteTool.description).toBeTruthy();
  });

  it("returns formatted text with price data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-05T16:00:00.000Z"));
    rateLimiter.configure("yahoo", 1000, 1000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(quoteFixture),
    });

    const result = await stockQuoteTool.execute("call-1", { symbol: "AAPL" });
    const text = result.content[0];
    expect(text.type).toBe("text");
    if (text.type !== "text") throw new Error("expected text content");
    expect(text.text).toContain("AAPL");
    expect(text.text).toContain("178.72");
    expect(text.text).toContain("52W Range");
    expect(text.text.split("\n").at(-1)).toMatch(/^As of 2026-07-02 16:00 ET \(.+\)\.$/);
  });

  it("returns StockQuote in details", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(quoteFixture),
    });

    const result = await stockQuoteTool.execute("call-2", { symbol: "aapl" });
    expect(result.details.symbol).toBe("AAPL");
    expect(result.details.price).toBe(178.72);
    expect(result.details.freshness.providerDataAt).toBe("2026-07-02T20:00:00.000Z");
  });

  it("discloses weekend-stale provider dates without the old cached prefix", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(weekendStaleQuoteFixture),
    });

    const result = await stockQuoteTool.execute("call-weekend-stale", { symbol: "WEEKEND" });
    const text = (result.content[0] as any).text;

    expect(text).toMatch(/Last available price as of 2024-03-22/i);
    expect(text).toContain("This is not a live quote.");
    expect(text).not.toContain("Using cached quote from");
  });

  it("uses the shared stale-cache wording instead of the old stale prefix", async () => {
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
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await stockQuoteTool.execute("call-stale-cache", { symbol: "AAPL" });
    const text = (result.content[0] as any).text;

    expect(text).toContain("Using cached data from");
    expect(text).not.toContain("Using cached quote from");
    expect(result.details.freshness.cacheStatus).toBe("stale");
  });

  it("uppercases the symbol", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(quoteFixture),
    });

    await stockQuoteTool.execute("call-3", { symbol: "aapl" });
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("AAPL"), expect.anything());
  });

  it("surfaces invalid sparse quote responses as unavailable without zero-filled details", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(invalidQuoteFixture),
    });

    const result = await stockQuoteTool.execute("call-4", { symbol: "XXFAKEXX" });

    expect(result.content[0].type).toBe("text");
    const text = result.content[0];
    if (text.type !== "text") throw new Error("expected text content");
    expect(text.text).toContain("Stock quote unavailable for XXFAKEXX");
    expect(text.text).toContain("Invalid symbol XXFAKEXX for yahoo");
    expect(result.details).toBeNull();
  });

  it("falls back to the configured Alpha Vantage quote when Yahoo is unavailable", async () => {
    process.env.ALPHA_VANTAGE_API_KEY = "test-av-key";
    resetConfigCache();
    rateLimiter.configure("yahoo", 1000, 1000);
    rateLimiter.configure("alphavantage", 1000, 1000);
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (String(url).includes("alphavantage.co")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(globalQuoteFixture) });
      }
      return Promise.reject(new Error("yahoo down"));
    });

    const result = await stockQuoteTool.execute("call-av-fallback", { symbol: "AAPL" });

    // The Alpha Vantage fixture is the only available price, so a successful
    // quote proves Yahoo was skipped in favour of the configured fallback.
    expect(result.details?.symbol).toBe("AAPL");
    expect(result.details?.price).toBe(186.35);
    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(urls.some((u: string) => u.includes("query1.finance.yahoo.com"))).toBe(true);
    expect(urls.some((u: string) => u.includes("alphavantage.co"))).toBe(true);
  });

  it("never calls Alpha Vantage when no key is configured", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("yahoo down"));

    const result = await stockQuoteTool.execute("call-no-av", { symbol: "AAPL" });

    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(urls.every((u: string) => !u.includes("alphavantage.co"))).toBe(true);
    const text = result.content[0];
    if (text.type !== "text") throw new Error("expected text content");
    expect(text.text).toContain("Stock quote unavailable for AAPL");
  });
});
