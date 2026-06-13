import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { searchTickerTool } from "../../../src/tools/market/search-ticker.js";

describe("search_ticker tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    rateLimiter.configure("yahoo", 1000, 1000);
    rateLimiter.configure("tradingview", 1000, 1000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns Yahoo search results without calling TradingView", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          quotes: [
            {
              symbol: "AAPL",
              shortname: "Apple Inc.",
              longname: "Apple Inc.",
              quoteType: "EQUITY",
              exchange: "NMS",
              score: 12345,
            },
          ],
        }),
    });

    const result = await searchTickerTool.execute("call-yahoo", { query: "apple" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((result.content[0] as any).text).toContain("AAPL");
    expect(result.details).toEqual([
      {
        symbol: "AAPL",
        shortname: "Apple Inc.",
        longname: "Apple Inc.",
        quoteType: "EQUITY",
        exchange: "NMS",
        score: 12345,
      },
    ]);
  });

  it("falls back to TradingView on Yahoo 429 while preserving the Yahoo quote shape", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            fields: ["name", "description", "exchange", "type", "typespecs"],
            symbols: [
              {
                s: "NASDAQ:AAPL",
                f: ["AAPL", "Apple Inc.", "NASDAQ", "stock", ["common"]],
              },
            ],
          }),
      });

    const resultPromise = searchTickerTool.execute("call-fallback", { query: "AAPL" });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(String(vi.mocked(fetch).mock.calls[3][0])).toContain(
      "scanner.tradingview.com/america/scan2",
    );
    expect((result.content[0] as any).text).toContain("TradingView fallback");
    expect(result.details).toEqual([
      {
        symbol: "AAPL",
        shortname: "Apple Inc.",
        longname: "Apple Inc.",
        quoteType: "EQUITY",
        exchange: "NASDAQ",
        score: 101000,
      },
    ]);
  });

  it("caps Yahoo Retry-After delays before using the TradingView fallback", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "60" : null) },
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "60" : null) },
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: { get: (name: string) => (name.toLowerCase() === "retry-after" ? "60" : null) },
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            fields: ["name", "description", "exchange", "type", "typespecs"],
            symbols: [
              {
                s: "NASDAQ:AAPL",
                f: ["AAPL", "Apple Inc.", "NASDAQ", "stock", ["common"]],
              },
            ],
          }),
      });

    const resultPromise = searchTickerTool.execute("call-capped-fallback", { query: "AAPL" });

    await vi.advanceTimersByTimeAsync(999);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);

    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(String(vi.mocked(fetch).mock.calls[3][0])).toContain(
      "scanner.tradingview.com/america/scan2",
    );
    expect((result.content[0] as any).text).toContain("TradingView fallback");
  });

  it("falls back to TradingView when Yahoo returns no matches", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ quotes: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            fields: ["name", "description", "exchange", "type", "typespecs"],
            symbols: [
              {
                s: "NASDAQ:MSFT",
                f: ["MSFT", "Microsoft Corporation", "NASDAQ", "stock", ["common"]],
              },
            ],
          }),
      });

    const result = await searchTickerTool.execute("call-empty", { query: "MSFT" });

    expect(fetch).toHaveBeenCalledTimes(2);
    expect((result.content[0] as any).text).toContain("MSFT");
    expect(result.details).toMatchObject([
      {
        symbol: "MSFT",
        longname: "Microsoft Corporation",
        quoteType: "EQUITY",
        exchange: "NASDAQ",
      },
    ]);
  });

  it("tries TradingView company-name matching when an exact ticker fallback is empty", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ fields: ["name", "description"], symbols: [] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            fields: ["name", "description", "exchange", "type", "typespecs"],
            symbols: [
              {
                s: "NASDAQ:AAPL",
                f: ["AAPL", "Apple Inc.", "NASDAQ", "stock", ["common"]],
              },
            ],
          }),
      });

    const resultPromise = searchTickerTool.execute("call-company-fallback", { query: "apple" });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect(fetch).toHaveBeenCalledTimes(5);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[3][1]?.body)).filter[0]).toEqual({
      left: "name",
      operation: "equal",
      right: "APPLE",
    });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[4][1]?.body)).filter[0]).toEqual({
      left: "description",
      operation: "match",
      right: "apple",
    });
    expect(result.details).toMatchObject([
      {
        symbol: "AAPL",
        longname: "Apple Inc.",
        quoteType: "EQUITY",
        exchange: "NASDAQ",
      },
    ]);
  });

  it("returns a structured no-result message if Yahoo and TradingView are both unavailable", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        text: () => Promise.resolve("rate limited"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: () => Promise.resolve("tradingview down"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: () => Promise.resolve("tradingview down"),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Server Error",
        text: () => Promise.resolve("tradingview down"),
      });

    const resultPromise = searchTickerTool.execute("call-double-failure", { query: "AAPL" });
    await vi.runAllTimersAsync();
    const result = await resultPromise;

    expect((result.content[0] as any).text).toContain("Yahoo search was unavailable");
    expect((result.content[0] as any).text).toContain("TradingView fallback was unavailable");
    expect(result.details).toEqual([]);
  });
});
