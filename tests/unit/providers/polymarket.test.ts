import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { searchPredictionMarkets } from "../../../src/providers/polymarket.js";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import searchFixture from "../../fixtures/polymarket/search.json";

describe("Polymarket provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T12:00:00.000Z"));
    cache.clear();
    rateLimiter.configure("polymarket", 1000, 1000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("maps open Gamma outcome prices, resolution criteria, URLs, volume, liquidity, close date, and provider as-of", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(searchFixture),
    });

    const quotes = await searchPredictionMarkets("fed rate cut", 8);

    expect(quotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "polymarket",
          marketId: "fixture-thin-market",
          title: "Will the Fed cut rates before the next meeting?",
          outcome: "Yes",
          probability: 0.18,
          volumeUsd: 9876.54,
          liquidityUsd: 432.1,
          closeDate: "2026-09-16T00:00:00Z",
          resolutionCriteria: expect.stringContaining("lowers the target rate"),
          url: "https://polymarket.com/event/fed-rate-cut-by-629/fixture-fed-thin-market",
          asOf: "2026-07-06T03:37:19.84513Z",
        }),
      ]),
    );
  });

  it("filters closed or inactive markets so settled prices are not shown as live odds", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(searchFixture),
    });

    const quotes = await searchPredictionMarkets("fed rate cut", 20);

    expect(quotes.map((quote) => quote.marketId)).not.toContain("949492");
    expect(quotes.map((quote) => quote.marketId)).not.toContain("949493");
    expect(quotes.map((quote) => quote.marketId)).toEqual(
      expect.arrayContaining(["fixture-thin-market", "fixture-missing-resolution"]),
    );
  });

  it("keeps explicitly open markets despite stale end dates while using end dates for flagless markets", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          markets: [
            {
              id: "explicitly-open-stale-date",
              question: "Will the Fed cut rates?",
              slug: "fed-cut-stale-date",
              outcomes: '["Yes","No"]',
              outcomePrices: '["0.0485","0.9515"]',
              closed: false,
              active: true,
              endDate: "2020-01-01T00:00:00Z",
            },
            {
              id: "explicitly-open-future-date",
              question: "Will the Fed cut rates?",
              slug: "fed-cut-future-date",
              outcomes: '["Yes"]',
              outcomePrices: '["0.5"]',
              closed: false,
              active: true,
              endDate: "2030-01-01T00:00:00Z",
            },
            {
              id: "explicitly-closed",
              question: "Will the Fed cut rates?",
              slug: "fed-cut-closed",
              outcomes: '["Yes"]',
              outcomePrices: '["1"]',
              closed: true,
              active: true,
            },
            {
              id: "flagless-stale-date",
              question: "Will the Fed cut rates?",
              slug: "fed-cut-flagless-stale",
              outcomes: '["Yes"]',
              outcomePrices: '["0.5"]',
              endDate: "2020-01-01T00:00:00Z",
            },
            {
              id: "not-settled-but-unconfirmed-stale-date",
              question: "Will the Fed cut rates?",
              slug: "fed-cut-not-settled-stale",
              outcomes: '["Yes"]',
              outcomePrices: '["0.5"]',
              closed: false,
              endDate: "2020-01-01T00:00:00Z",
            },
            {
              id: "flagless-future-date",
              question: "Will the Fed cut rates?",
              slug: "fed-cut-flagless-future",
              outcomes: '["Yes"]',
              outcomePrices: '["0.5"]',
              endDate: "2030-01-01T00:00:00Z",
            },
            {
              id: "flagless-no-date",
              question: "Will the Fed cut rates?",
              slug: "fed-cut-flagless-no-date",
              outcomes: '["Yes"]',
              outcomePrices: '["0.5"]',
            },
          ],
        }),
    });

    const quotes = await searchPredictionMarkets("fed rate cut market status", 8);

    expect(quotes.map((quote) => quote.marketId)).toEqual(
      expect.arrayContaining([
        "explicitly-open-stale-date",
        "explicitly-open-future-date",
        "flagless-future-date",
        "flagless-no-date",
      ]),
    );
    const marketIds = quotes.map((quote) => quote.marketId);
    expect(marketIds).not.toContain("explicitly-closed");
    expect(marketIds).not.toContain("flagless-stale-date");
    expect(marketIds).not.toContain("not-settled-but-unconfirmed-stale-date");

    // A past close date on an explicitly active market is the same stale
    // metadata the filter ignores; it must not surface as a "Close:" line.
    const staleDateQuote = quotes.find((quote) => quote.marketId === "explicitly-open-stale-date");
    expect(staleDateQuote?.closeDate).toBeUndefined();
    const futureDateQuote = quotes.find(
      (quote) => quote.marketId === "explicitly-open-future-date",
    );
    expect(futureDateQuote?.closeDate).toBe("2030-01-01T00:00:00Z");
  });

  it("preserves outcome-price positions when skipping malformed Polymarket prices", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          markets: [
            {
              id: "sparse-prices",
              question: "Will the Fed cut rates?",
              slug: "fed-cut",
              outcomes: '["Yes","No"]',
              outcomePrices: '[null,"0.82"]',
              active: true,
              closed: false,
              endDate: "2026-09-16T00:00:00Z",
              updatedAt: "2026-07-06T03:37:19.84513Z",
            },
          ],
        }),
    });

    const quotes = await searchPredictionMarkets("fed rate cut sparse", 8);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ outcome: "No", probability: 0.82 });
  });

  it("omits provider as-of when Gamma does not supply an update timestamp", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          markets: [
            {
              id: "no-updated-at",
              question: "Will the Fed cut rates?",
              slug: "fed-cut",
              outcomes: '["Yes"]',
              outcomePrices: '["0.52"]',
              active: true,
              closed: false,
              endDate: "2026-09-16T00:00:00Z",
            },
          ],
        }),
    });

    const quotes = await searchPredictionMarkets("fed rate cut no timestamp", 8);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.asOf).toBeUndefined();
  });

  it("drops out-of-bounds probabilities from malformed Polymarket prices", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          markets: [
            {
              id: "bad-probabilities",
              question: "Will the Fed cut rates?",
              slug: "fed-cut",
              outcomes: '["Yes","No","Maybe"]',
              outcomePrices: '["1.2","-0.1","0.45"]',
              active: true,
              closed: false,
              endDate: "2026-09-16T00:00:00Z",
              updatedAt: "2026-07-06T03:37:19.84513Z",
            },
          ],
        }),
    });

    const quotes = await searchPredictionMarkets("fed rate cut bad probabilities", 8);

    expect(quotes).toHaveLength(1);
    expect(quotes[0]).toMatchObject({ outcome: "Maybe", probability: 0.45 });
  });

  it("serves identical searches from cache without a second network request", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(searchFixture),
    });

    await searchPredictionMarkets("fed rate cut", 8);
    await searchPredictionMarkets("fed rate cut", 8);

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("uses the polymarket rate-limiter bucket", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(searchFixture),
    });
    const acquire = vi.spyOn(rateLimiter, "acquire");

    await searchPredictionMarkets("fed rate cut", 8);

    expect(acquire).toHaveBeenCalledWith("polymarket");
  });

  it("falls back to stale cache when a repeated request fails", async () => {
    let now = new Date("2026-07-06T03:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    rateLimiter.configure("polymarket", 1000, 1000);
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(searchFixture),
      })
      .mockRejectedValueOnce(new Error("network down"));

    const first = await searchPredictionMarkets("fed rate cut", 8);
    now = new Date("2026-07-06T03:06:00.000Z").getTime();
    const second = await searchPredictionMarkets("fed rate cut", 8);

    expect(second).toEqual(first);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable through the provider wrapper when no cache exists", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await wrapProvider("polymarket", () => searchPredictionMarkets("no cache", 8));

    expect(result).toMatchObject({
      status: "unavailable",
      provider: "polymarket",
      reason: "network down",
    });
  });
});
