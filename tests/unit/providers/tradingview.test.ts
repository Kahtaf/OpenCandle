import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { buildTvSymbol, getQuotes, screenStocks } from "../../../src/providers/tradingview.js";
import bareQuotesFixture from "../../fixtures/tradingview/bare-quotes.json";
import qualifiedQuotesFixture from "../../fixtures/tradingview/qualified-quotes.json";
import shuffledFieldsFixture from "../../fixtures/tradingview/screen-fields-shuffled.json";
import screenResultsFixture from "../../fixtures/tradingview/screen-results.json";

describe("TradingView provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    rateLimiter.configure("tradingview", 1000, 1000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("builds TradingView symbols from exchange and ticker", () => {
    expect(buildTvSymbol(" nasdaq ", " aapl ")).toBe("NASDAQ:AAPL");
    expect(buildTvSymbol("NYSE", "brk.a")).toBe("NYSE:BRK.A");
    expect(buildTvSymbol("", "NASDAQ:MSFT")).toBe("NASDAQ:MSFT");
  });

  it("screens stocks with flat filters, sorted columns, limit defaults, and TradingView headers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(screenResultsFixture),
    });

    const rows = await screenStocks({
      market: "america",
      columns: ["name", "close", "change", "volume", "market_cap_basic", "RSI|60"],
      filter: [
        { field: "RSI|60", op: "less", value: 30 },
        { field: "market_cap_basic", op: "greater", value: 10_000_000_000 },
      ],
      sort: { field: "volume", direction: "desc" },
      limit: 0,
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      tvSymbol: "NASDAQ:AAPL",
      symbol: "AAPL",
      values: { "RSI|60": 29.4, market_cap_basic: 2900000000000 },
      sourceProvider: "tradingview",
    });
    expect("asOf" in rows[0]).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      "https://scanner.tradingview.com/america/scan2?label-product=screener-stock",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Origin: "https://www.tradingview.com",
          Referer: "https://www.tradingview.com/",
          "User-Agent": expect.stringContaining("Mozilla/5.0"),
        }),
        body: JSON.stringify({
          markets: ["america"],
          columns: ["name", "close", "change", "volume", "market_cap_basic", "RSI|60"],
          filter: [
            { left: "RSI|60", operation: "less", right: 30 },
            { left: "market_cap_basic", operation: "greater", right: 10000000000 },
          ],
          sort: { sortBy: "volume", sortOrder: "desc" },
          range: [0, 50],
          options: { lang: "en" },
        }),
      }),
    );
  });

  it("resolves bare US equity symbols through an america name lookup, not unqualified tickers", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(bareQuotesFixture),
    });

    const quotes = await getQuotes(["AAPL", "BRK.A", "SPY", "BTC-USD"]);

    expect(quotes.map((quote) => quote.requestedSymbol)).toEqual(["AAPL", "BRK.A", "SPY"]);
    expect(quotes.map((quote) => quote.tvSymbol)).toEqual([
      "NASDAQ:AAPL",
      "NYSE:BRK.A",
      "AMEX:SPY",
    ]);
    expect(quotes.some((quote) => "asOf" in quote)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(body.symbols).toEqual({ query: { types: [] } });
    expect(body.filter).toEqual([
      { left: "name", operation: "in_range", right: ["AAPL", "BRK.A", "SPY"] },
      { left: "is_primary", operation: "equal", right: true },
      { left: "type", operation: "in_range", right: ["stock", "fund", "dr"] },
    ]);
  });

  it("uses at most two POSTs for mixed qualified and bare inputs and preserves caller order", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(qualifiedQuotesFixture),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(bareQuotesFixture),
      });

    const quotes = await getQuotes(["NASDAQ:AAPL", "SPY", "NASDAQ:MSFT"]);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(
      "https://scanner.tradingview.com/global/scan2?label-product=screener-stock",
    );
    expect(vi.mocked(fetch).mock.calls[1][0]).toBe(
      "https://scanner.tradingview.com/america/scan2?label-product=screener-stock",
    );
    expect(quotes.map((quote) => quote.requestedSymbol)).toEqual([
      "NASDAQ:AAPL",
      "SPY",
      "NASDAQ:MSFT",
    ]);
    expect(quotes.map((quote) => quote.tvSymbol)).toEqual([
      "NASDAQ:AAPL",
      "AMEX:SPY",
      "NASDAQ:MSFT",
    ]);
  });

  it("caches scanner results under a canonical body key", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(screenResultsFixture),
    });

    await screenStocks({
      market: "america",
      columns: ["name", "close"],
      sort: { field: "volume", direction: "desc" },
      filter: [{ field: "close", op: "greater", value: 100 }],
    });
    await screenStocks({
      columns: ["name", "close"],
      filter: [{ value: 100, op: "greater", field: "close" } as any],
      sort: { direction: "desc", field: "volume" } as any,
      market: "america",
    });

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("decodes rows by response fields and backfills missing requested columns as null", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(shuffledFieldsFixture),
    });

    const rows = await screenStocks({
      market: "america",
      columns: ["name", "close", "volume", "RSI|60"],
      limit: 1,
    });

    expect(rows[0]?.values).toEqual({
      name: "AAPL",
      close: 190.5,
      volume: null,
      "RSI|60": 29.4,
    });
  });

  it("treats quote rows without a finite close as unresolved", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          fields: ["name", "volume", "exchange", "market", "description", "type", "typespecs"],
          symbols: [
            {
              s: "NASDAQ:AAPL",
              f: ["AAPL", 1000, "NASDAQ", "america", "Apple Inc.", "stock", ["common"]],
            },
          ],
        }),
    });

    await expect(getQuotes(["AAPL"])).resolves.toEqual([]);
  });

  it("serves stale scanner data when a repeated request fails within the stale window", async () => {
    let now = new Date("2026-06-01T00:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    rateLimiter.configure("tradingview", 1000, 1000);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(screenResultsFixture),
      })
      .mockRejectedValueOnce(new Error("network down"));

    const first = await screenStocks({ market: "america", columns: ["name", "close"], limit: 2 });
    now = new Date("2026-06-01T00:02:00.000Z").getTime();
    const second = await screenStocks({ market: "america", columns: ["name", "close"], limit: 2 });

    expect(fetch).toHaveBeenCalledTimes(4);
    expect(second).toEqual(first);
  });
});
