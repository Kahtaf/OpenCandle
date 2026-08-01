import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { httpGet } from "../../../src/infra/http-client.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import {
  resolveYahooInstrument,
  searchYahooInstruments,
} from "../../../src/market-state/resolve.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import type { StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/infra/http-client.js", () => ({
  httpGet: vi.fn(),
}));
vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

let acquireSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  cache.clear();
  acquireSpy = vi.spyOn(rateLimiter, "acquire").mockResolvedValue();
});

afterEach(() => {
  acquireSpy.mockRestore();
  cache.clear();
});

describe("searchYahooInstruments", () => {
  it("returns normalized resolver candidates for autocomplete", async () => {
    vi.mocked(httpGet).mockResolvedValue({
      quotes: [
        {
          symbol: "AAPL",
          shortname: "Apple Inc.",
          quoteType: "EQUITY",
          exchange: "NMS",
          score: 101,
        },
      ],
    });

    const results = await searchYahooInstruments("apple");

    expect(results).toEqual([
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        quoteType: "EQUITY",
        assetType: "equity",
        exchange: "NMS",
        provider: "yahoo",
        score: 101,
      },
    ]);
    expect(acquireSpy).toHaveBeenCalledWith("yahoo");
  });

  it("caches Yahoo autocomplete results to avoid repeated provider calls", async () => {
    vi.mocked(httpGet).mockResolvedValue({
      quotes: [
        {
          symbol: "AAPL",
          shortname: "Apple Inc.",
          quoteType: "EQUITY",
          exchange: "NMS",
        },
      ],
    });

    const first = await searchYahooInstruments("apple");
    const second = await searchYahooInstruments("apple");

    expect(first).toEqual(second);
    expect(httpGet).toHaveBeenCalledTimes(1);
    expect(acquireSpy).toHaveBeenCalledTimes(1);
  });

  it("returns candidate lists without mutating state for misspelled ticker-like input", async () => {
    vi.mocked(httpGet).mockResolvedValue({
      quotes: [
        {
          symbol: "APLD",
          longname: "Applied Digital Corporation",
          quoteType: "EQUITY",
          exchange: "NMS",
          score: 20,
        },
      ],
    });

    const results = await searchYahooInstruments("APL");

    expect(results[0].symbol).toBe("APLD");
    expect(results[0].symbol).not.toBe("APL");
  });

  it("preserves provider quote currency when resolving an exact symbol", async () => {
    vi.mocked(getQuote).mockResolvedValue(quote("SHOP.TO", 120, { currency: "CAD" }));

    const instrument = await resolveYahooInstrument("SHOP.TO");

    expect(instrument).toMatchObject({
      symbol: "SHOP.TO",
      currency: "CAD",
      provider: "yahoo",
    });
  });

  it.each([
    ["BTC-INR", "crypto"],
    ["BRK-B", "equity"],
  ])("infers %s as %s when resolving an exact Yahoo symbol", async (symbol, assetType) => {
    vi.mocked(getQuote).mockResolvedValue(quote(symbol, 120));

    await expect(resolveYahooInstrument(symbol)).resolves.toMatchObject({ symbol, assetType });
  });
});

function quote(symbol: string, price: number, overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    symbol,
    price,
    change: 0,
    changePercent: 0,
    open: price,
    high: price,
    low: price,
    previousClose: price,
    volume: 1_000,
    marketCap: 0,
    pe: null,
    week52High: price + 10,
    week52Low: price - 10,
    timestamp: Date.now(),
    ...overrides,
  };
}
