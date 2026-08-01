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
        headers: {
          "content-type": "image/svg+xml",
          "x-data-as-of": "2026-08-01T00:00:00.000Z",
        },
      }),
    );
    vi.stubGlobal("fetch", providerFetch);

    await expect(fetchTickerLineSparkline("BTC-USD", "crypto")).resolves.toMatchObject({
      status: "ok",
      dataAsOf: "2026-08-01T00:00:00.000Z",
    });
    await expect(fetchTickerLineSparkline("BTC-USD", "crypto")).resolves.toMatchObject({
      status: "ok",
    });

    expect(providerFetch).toHaveBeenCalledOnce();
    expect(String(providerFetch.mock.calls[0][0])).toMatch(
      /^https:\/\/ticker-line\.com\/v1\/sparkline\?/,
    );
    expect(String(providerFetch.mock.calls[0][0])).toContain(
      "ticker=BTC%2FUSD&market=crypto&timeframe=1d",
    );
  });

  it("coalesces concurrent cold-cache requests for the same instrument", async () => {
    const providerFetch = vi.fn().mockResolvedValue(
      new Response('<svg xmlns="http://www.w3.org/2000/svg"></svg>', {
        headers: { "x-data-as-of": "2026-08-01T00:00:00.000Z" },
      }),
    );
    vi.stubGlobal("fetch", providerFetch);

    const results = await Promise.all([
      fetchTickerLineSparkline("AAPL", "equity"),
      fetchTickerLineSparkline("AAPL", "equity"),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ status: "ok" }),
      expect.objectContaining({ status: "ok" }),
    ]);
    expect(providerFetch).toHaveBeenCalledOnce();
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

  it("rejects a stale provider fallback instead of presenting it as current", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("<svg></svg>", {
          headers: {
            "x-cache": "STALE",
            "x-data-as-of": "2026-07-30T20:00:00.000Z",
          },
        }),
      ),
    );

    await expect(fetchTickerLineSparkline("AAPL", "equity")).resolves.toEqual({
      status: "unavailable",
      reason: "Ticker Line returned stale market data as of 2026-07-30T20:00:00.000Z",
    });
  });

  it("stops streaming an SVG as soon as it exceeds the size limit", async () => {
    const cancelStream = vi.fn();
    const oversizedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(300 * 1024));
        controller.enqueue(new Uint8Array(300 * 1024));
      },
      cancel: cancelStream,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(oversizedBody)));

    await expect(fetchTickerLineSparkline("AAPL", "equity")).resolves.toEqual({
      status: "unavailable",
      reason: "Ticker Line SVG exceeded the size limit",
    });
    expect(cancelStream).toHaveBeenCalledOnce();
  });
});
