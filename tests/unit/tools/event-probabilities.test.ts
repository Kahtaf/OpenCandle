import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { eventProbabilitiesTool } from "../../../src/tools/macro/event-probabilities.js";
import searchFixture from "../../fixtures/polymarket/search.json";

describe("eventProbabilitiesTool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    rateLimiter.configure("polymarket", 1000, 1000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("formats probabilities with mandatory caveats and typed quote details", async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => searchFixture,
      }) as Response;

    const result = await eventProbabilitiesTool.execute("call-1", {
      query: "fed rate cut september",
      limit: 8,
    });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("0.0% - Yes");
    expect(text).toContain("Volume: $588,114.76");
    expect(text).toContain("Close: 2026-01-28T00:00:00Z");
    expect(text).toContain("Resolution criteria:");
    expect(text).toContain(
      "market-implied probabilities from trader positioning, not calibrated forecasts",
    );
    expect(text).toContain("Thin markets can show noisy or stale prices");
    expect(text).toContain("Polymarket is a crypto-settled venue");
    expect(result.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "polymarket",
          marketId: "949492",
          outcome: "Yes",
          probability: 0,
        }),
      ]),
    );
  });

  it("flags low-liquidity markets under $10,000 volume and notes missing resolution criteria", async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => searchFixture,
      }) as Response;

    const result = await eventProbabilitiesTool.execute("call-1", {
      query: "fed rate cut",
      limit: 10,
    });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("18.0% - Yes");
    expect(text).toContain("LOW-LIQUIDITY: volume under $10,000");
    expect(text).toContain("42.0% - Yes");
    expect(text).toContain("Resolution criteria unavailable from Polymarket.");
  });

  it("reports an honest empty result without substituting related markets", async () => {
    globalThis.fetch = async () =>
      ({
        ok: true,
        json: async () => ({ events: [], markets: [] }),
      }) as Response;

    const result = await eventProbabilitiesTool.execute("call-1", {
      query: "an event with no market",
    });

    const text = result.content[0]?.text ?? "";
    expect(text).toContain('No Polymarket prediction markets found for "an event with no market".');
    expect(text).toContain("not calibrated forecasts");
    expect(result.details).toEqual([]);
  });
});
