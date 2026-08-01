import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTickerLineSparkline } from "../../../gui/server/ticker-line-sparkline.js";
import { cache } from "../../../src/infra/cache.js";

describe("Ticker Line sparkline proxy", () => {
  beforeEach(() => cache.clear());

  afterEach(() => {
    cache.clear();
    vi.unstubAllGlobals();
  });

  it("fetches a market-aware SVG once and caches it", async () => {
    const providerFetch = vi.fn().mockResolvedValue(
      new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
        headers: { "content-type": "image/svg+xml" },
      }),
    );
    vi.stubGlobal("fetch", providerFetch);

    await expect(fetchTickerLineSparkline("BTC-USD", "crypto")).resolves.toMatchObject({
      status: "ok",
    });
    await expect(fetchTickerLineSparkline("BTC-USD", "crypto")).resolves.toMatchObject({
      status: "ok",
    });

    expect(providerFetch).toHaveBeenCalledOnce();
    expect(String(providerFetch.mock.calls[0][0])).toMatch(
      /^https:\/\/ticker-line\.dev\/api\/v1\/sparkline\?/,
    );
    expect(String(providerFetch.mock.calls[0][0])).toContain(
      "ticker=BTC%2FUSD&market=crypto&timeframe=1d",
    );
  });

  it("rejects unsupported symbols without contacting the provider", async () => {
    const providerFetch = vi.fn();
    vi.stubGlobal("fetch", providerFetch);

    await expect(fetchTickerLineSparkline("ES=F", "unknown")).resolves.toEqual({
      status: "invalid_request",
      reason: "Unsupported Ticker Line instrument",
    });
    expect(providerFetch).not.toHaveBeenCalled();
  });

  it("rejects a non-SVG provider response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not an svg")));

    await expect(fetchTickerLineSparkline("AAPL", "equity")).resolves.toEqual({
      status: "unavailable",
      reason: "Ticker Line returned an invalid SVG",
    });
  });

  it("does not cache Ticker Line's HTTP-200 semantic error SVG", async () => {
    const providerFetch = vi.fn().mockResolvedValue(
      new Response("<svg></svg>", {
        headers: { "x-error-code": "INSUFFICIENT_DATA", "x-error-status": "422" },
      }),
    );
    vi.stubGlobal("fetch", providerFetch);

    await expect(fetchTickerLineSparkline("AAPL", "equity")).resolves.toEqual({
      status: "unavailable",
      reason: "Ticker Line unavailable: INSUFFICIENT_DATA",
    });
    await fetchTickerLineSparkline("AAPL", "equity");
    expect(providerFetch).toHaveBeenCalledTimes(2);
  });
});
