import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { searchPredictionMarkets } from "../../../src/providers/polymarket.js";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import searchFixture from "../../fixtures/polymarket/search.json";

describe("Polymarket provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    rateLimiter.configure("polymarket", 1000, 1000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("maps Gamma outcome prices, resolution criteria, URLs, volume, liquidity, and close date", async () => {
    vi.spyOn(Date.prototype, "toISOString").mockReturnValue("2026-07-06T03:40:00.000Z");
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(searchFixture),
    });

    const quotes = await searchPredictionMarkets("fed rate cut", 8);

    expect(quotes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "polymarket",
          marketId: "949492",
          title: "Fed rate cut by January 2026 meeting?",
          outcome: "Yes",
          probability: 0,
          volumeUsd: 588114.763678,
          closeDate: "2026-01-28T00:00:00Z",
          resolutionCriteria: expect.stringContaining("target federal funds rate"),
          url: "https://polymarket.com/event/fed-rate-cut-by-629/fed-rate-cut-by-january-2026-meeting-412",
          asOf: "2026-07-06T03:40:00.000Z",
        }),
        expect.objectContaining({
          marketId: "fixture-thin-market",
          outcome: "Yes",
          probability: 0.18,
          volumeUsd: 9876.54,
          liquidityUsd: 432.1,
        }),
      ]),
    );
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
