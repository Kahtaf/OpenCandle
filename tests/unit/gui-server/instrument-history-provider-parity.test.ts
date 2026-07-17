import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInstrumentHistorySnapshot,
  resetInstrumentHistoryMemoForTests,
} from "../../../gui/server/market-state-api.js";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import alphaVantageHistory from "../../fixtures/alphavantage/AAPL-time-series-daily.json";
import yahooHistory from "../../fixtures/yahoo/AAPL-history.json";

vi.mock("../../../src/config.js", () => ({
  getConfig: () => ({ alphaVantageApiKey: "av-test-key", lseApiKey: "lse-test-key" }),
}));

vi.mock("../../../src/infra/lse-byte-budget.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/infra/lse-byte-budget.js")>();
  return {
    ...actual,
    isOverSoftThreshold: () => false,
    markExhausted: vi.fn(),
    recordBytes: vi.fn(),
  };
});

describe("instrument history provider parity", () => {
  beforeEach(() => {
    cache.clear();
    resetInstrumentHistoryMemoForTests();
    rateLimiter.configure("yahoo", 100, 100);
    rateLimiter.configure("alphavantage", 100, 100);
    rateLimiter.configure("lse", 100, 100);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    cache.clear();
  });

  it("attributes a successful Yahoo history response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(yahooHistory)));

    await expect(getInstrumentHistorySnapshot("AAPL", "1D")).resolves.toMatchObject({
      status: "ok",
      source: "Yahoo Finance",
      interval: "5m",
    });
  });

  it("uses Alpha Vantage when Yahoo history is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const host = new URL(input instanceof Request ? input.url : String(input)).hostname;
        if (host.includes("yahoo")) {
          return Promise.resolve(new Response("{}", { status: 404 }));
        }
        if (host === "www.alphavantage.co") {
          return Promise.resolve(Response.json(alphaVantageHistory));
        }
        throw new Error(`Unexpected provider host: ${host}`);
      }),
    );

    await expect(getInstrumentHistorySnapshot("AAPL", "6M")).resolves.toMatchObject({
      status: "ok",
      source: "Alpha Vantage",
      interval: "1d",
    });
  });

  it("preserves finite epoch-second timestamps through the LSE intraday fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.hostname.includes("yahoo")) {
          return Promise.resolve(new Response("{}", { status: 404 }));
        }
        if (url.hostname === "api.londonstrategicedge.com") {
          return Promise.resolve(
            Response.json([
              {
                ts: "2026-07-16T14:35:00",
                open: 210,
                high: 212,
                low: 209,
                close: 211,
                volume: 12_345,
              },
            ]),
          );
        }
        throw new Error(`Unexpected provider host: ${url.hostname}`);
      }),
    );

    const snapshot = await getInstrumentHistorySnapshot("AAPL", "1D");

    expect(snapshot).toMatchObject({ status: "ok", source: "London Strategic Edge" });
    if (snapshot.status !== "ok") throw new Error("expected available history");
    expect(snapshot.bars[0]).toMatchObject({
      time: Date.UTC(2026, 6, 16, 14, 35) / 1_000,
    });
    expect(Number.isFinite(snapshot.bars[0]?.time)).toBe(true);
  });
});
