import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import {
  clearCrumbCache,
  computeTimeToExpiry,
  getOptionsChain,
  getYahooCrumb,
} from "../../../src/providers/yahoo-finance.js";
import optionsFixture from "../../fixtures/yahoo/options-AAPL.json";

const yahooFinanceMock = vi.hoisted(() => ({
  options: vi.fn(),
}));

vi.mock("yahoo-finance2", () => ({
  default: vi.fn(function YahooFinance() {
    return { options: yahooFinanceMock.options };
  }),
}));

describe("computeTimeToExpiry", () => {
  // Expiration: 2026-03-30 00:00 UTC (midnight) = 1774828800
  const expirationTs = 1774828800;

  it("returns positive timeYears on expiration morning (10 AM ET = 14:00 UTC)", () => {
    // 2026-03-30 14:00 UTC = midnight + 14*3600 = 1774828800 + 50400 = 1774879200
    const nowMs = (expirationTs + 14 * 3600) * 1000;
    const t = computeTimeToExpiry(expirationTs, nowMs);
    expect(t).toBeGreaterThan(0);
  });

  it("returns positive timeYears at 3 PM ET on expiration day (19:00 UTC)", () => {
    const nowMs = (expirationTs + 19 * 3600) * 1000;
    const t = computeTimeToExpiry(expirationTs, nowMs);
    expect(t).toBeGreaterThan(0);
  });

  it("returns zero after market close (4 PM ET = 20:00 UTC) on expiration day", () => {
    // After 21:00 UTC (4 PM EDT), options have expired
    const nowMs = (expirationTs + 21 * 3600 + 1) * 1000;
    const t = computeTimeToExpiry(expirationTs, nowMs);
    expect(t).toBe(0);
  });

  it("returns positive timeYears the day before expiration", () => {
    // 2026-03-29 12:00 UTC = expirationTs - 12*3600
    const nowMs = (expirationTs - 12 * 3600) * 1000;
    const t = computeTimeToExpiry(expirationTs, nowMs);
    expect(t).toBeGreaterThan(0);
  });

  it("has a minimum floor to prevent numerical instability", () => {
    // Just before market close on expiration day
    const nowMs = (expirationTs + 20 * 3600 + 3599) * 1000; // 20:59:59 UTC
    const t = computeTimeToExpiry(expirationTs, nowMs);
    expect(t).toBeGreaterThan(0);
    // Floor should be at least ~1 hour in years
    expect(t).toBeGreaterThanOrEqual(1 / (365 * 24));
  });
});

describe("yahoo-finance options provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    clearCrumbCache();
    yahooFinanceMock.options.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe("getYahooCrumb", () => {
    it("accepts the hosted relay cookie side channel", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({
            "x-opencandle-upstream-set-cookie": "A3=d=hostedcookie; Path=/",
          }),
          text: () => Promise.resolve(""),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve("hostedCrumb"),
        });

      await expect(getYahooCrumb()).resolves.toEqual({
        crumb: "hostedCrumb",
        cookie: "A3=d=hostedcookie",
      });
      expect((fetch as any).mock.calls[1][1]?.headers.Cookie).toBe("A3=d=hostedcookie");
    });

    it("extracts crumb from consent redirect", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          // First call: fc.yahoo.com sets cookie
          ok: true,
          headers: new Headers({ "set-cookie": "A3=d=testcookie123; Path=/; Domain=.yahoo.com" }),
          text: () => Promise.resolve(""),
        })
        .mockResolvedValueOnce({
          // Second call: getcrumb returns the crumb
          ok: true,
          text: () => Promise.resolve("testCrumb123"),
        });

      const result = await getYahooCrumb();
      expect(result.crumb).toBe("testCrumb123");
      expect(result.cookie).toContain("testcookie123");
    });

    it("caches crumb on second call", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          headers: new Headers({ "set-cookie": "A3=d=cookie1; Path=/" }),
          text: () => Promise.resolve(""),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve("crumb1"),
        });

      await getYahooCrumb();
      await getYahooCrumb();
      // Only 2 fetch calls for the first crumb acquisition, 0 for the second (cached)
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("accepts Yahoo's 404 cookie bootstrap response when it sets a usable cookie", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          statusText: "Not Found",
          headers: new Headers({ "set-cookie": "A3=d=livecookie; Path=/; Domain=.yahoo.com" }),
          text: () => Promise.resolve(""),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () => Promise.resolve("liveCrumb"),
        });

      const result = await getYahooCrumb();

      expect(result).toEqual({ crumb: "liveCrumb", cookie: "A3=d=livecookie" });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect((fetch as any).mock.calls[1][1]?.headers.Cookie).toBe("A3=d=livecookie");
    });

    it("uses timeouts and validates the cookie response before requesting a crumb", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers(),
        text: () => Promise.resolve(""),
      });

      await expect(getYahooCrumb()).rejects.toThrow("Yahoo crumb cookie request failed: HTTP 503");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect((fetch as any).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    });

    it("fails fast when Yahoo does not return a crumb cookie", async () => {
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        headers: new Headers(),
        text: () => Promise.resolve(""),
      });

      await expect(getYahooCrumb()).rejects.toThrow(
        "Yahoo crumb cookie request did not return a session cookie",
      );
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("getOptionsChain", () => {
    function mockCrumbAndOptions() {
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("fc.yahoo.com")) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ "set-cookie": "A3=d=testcookie; Path=/" }),
            text: () => Promise.resolve(""),
          });
        }
        if (typeof url === "string" && url.includes("getcrumb")) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("testCrumb"),
          });
        }
        // Options endpoint
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(optionsFixture),
        });
      });
    }

    it("returns OptionsChain with contracts and Greeks", async () => {
      mockCrumbAndOptions();
      const chain = await getOptionsChain("AAPL");
      expect(chain.symbol).toBe("AAPL");
      expect(chain.underlyingPrice).toBe(248.8);
      expect(chain.asOf).toBe("2024-03-22T20:00:00.000Z");
      expect(chain.calls.length).toBeGreaterThan(0);
      expect(chain.puts.length).toBeGreaterThan(0);
      expect(chain.expirationDates.length).toBeGreaterThan(0);
    });

    it("uses timeouts for direct raw Yahoo options fetches", async () => {
      mockCrumbAndOptions();
      await getOptionsChain("AAPL");

      const fetchCalls = (fetch as any).mock.calls;
      expect(fetchCalls).toHaveLength(3);
      for (const call of fetchCalls) {
        expect(call[1]?.signal).toBeInstanceOf(AbortSignal);
      }
    });

    it("computes Greeks for each contract", async () => {
      mockCrumbAndOptions();
      const chain = await getOptionsChain("AAPL");
      const call = chain.calls[0];
      expect(call.greeks).toBeDefined();
      expect(call.greeks.delta).toBeGreaterThan(0); // call delta is positive
      expect(call.greeks.gamma).toBeGreaterThan(0);
      expect(call.greeks.theta).toBeLessThan(0); // time decay
      expect(call.greeks.vega).toBeGreaterThan(0);
    });

    it("put Greeks have negative delta", async () => {
      mockCrumbAndOptions();
      const chain = await getOptionsChain("AAPL");
      const put = chain.puts[0];
      expect(put.greeks.delta).toBeLessThan(0);
    });

    it("includes volume totals and put/call ratio", async () => {
      mockCrumbAndOptions();
      const chain = await getOptionsChain("AAPL");
      expect(chain.totalCallVolume).toBeGreaterThanOrEqual(0);
      expect(chain.totalPutVolume).toBeGreaterThanOrEqual(0);
      expect(typeof chain.putCallRatio).toBe("number");
    });

    it("labels all-zero bid/ask outside regular options hours as closed-market stale quotes", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-20T12:26:00Z")); // 8:26 AM EDT
      rateLimiter.configure("yahoo", 5, 5);
      const fixture = structuredClone(optionsFixture);
      for (const contract of fixture.optionChain.result[0].options[0].calls) {
        contract.bid = 0;
        contract.ask = 0;
      }
      for (const contract of fixture.optionChain.result[0].options[0].puts) {
        contract.bid = 0;
        contract.ask = 0;
      }
      mockCrumbAndOptions();
      (fetch as any).mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("fc.yahoo.com")) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ "set-cookie": "A3=d=testcookie; Path=/" }),
            text: () => Promise.resolve(""),
          });
        }
        if (typeof url === "string" && url.includes("getcrumb")) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("testCrumb"),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(fixture),
        });
      });

      const chain = await getOptionsChain("AAPL");

      expect(chain.quoteStatus.marketSession).toBe("pre_market");
      expect(chain.quoteStatus.bidAskState).toBe("closed_market_or_stale_quotes");
      expect(chain.quoteStatus.warning).toContain("before regular options trading");
      vi.useRealTimers();
    });

    it("caches options chain", async () => {
      mockCrumbAndOptions();
      await getOptionsChain("AAPL");
      await getOptionsChain("AAPL");
      // Options endpoint should only be called once (cached on second call)
      const optionsCalls = (fetch as any).mock.calls.filter(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("/v7/finance/options/"),
      );
      expect(optionsCalls.length).toBe(1);
    });

    it("falls back to yahoo-finance2 when direct options fetch fails", async () => {
      const fallbackFixture = structuredClone(optionsFixture.optionChain.result[0]);
      fallbackFixture.quote.regularMarketTime = new Date("2024-03-22T20:00:00.000Z") as any;
      yahooFinanceMock.options.mockResolvedValue(fallbackFixture);

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("fc.yahoo.com")) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ "set-cookie": "A3=d=testcookie; Path=/" }),
            text: () => Promise.resolve(""),
          });
        }
        if (typeof url === "string" && url.includes("getcrumb")) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("testCrumb"),
          });
        }
        return Promise.reject(new Error("fetch failed"));
      });

      const chain = await getOptionsChain("AAPL");

      expect(yahooFinanceMock.options).toHaveBeenCalledWith("AAPL", undefined);
      expect(chain.symbol).toBe("AAPL");
      expect(chain.asOf).toBe("2024-03-22T20:00:00.000Z");
      expect(chain.calls.length).toBeGreaterThan(0);
    });

    it("falls back to yahoo-finance2 when initial crumb acquisition fails", async () => {
      yahooFinanceMock.options.mockResolvedValue(optionsFixture.optionChain.result[0]);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers(),
        text: () => Promise.resolve(""),
      });

      const chain = await getOptionsChain("AAPL");

      expect(yahooFinanceMock.options).toHaveBeenCalledWith("AAPL", undefined);
      expect(chain.symbol).toBe("AAPL");
      expect(chain.calls.length).toBeGreaterThan(0);
    });

    it("returns stale cached options when crumb acquisition and yahoo-finance2 fallback fail", async () => {
      const staleChain = {
        symbol: "AAPL",
        underlyingPrice: 100,
        expirationDate: "2026-06-19",
        expirationDates: ["2026-06-19"],
        calls: [],
        puts: [],
        totalCallVolume: 0,
        totalPutVolume: 0,
        putCallRatio: 0,
        quoteStatus: {
          marketSession: "closed",
          bidAskState: "mixed_or_unknown",
          zeroBidAskContracts: 0,
          totalContracts: 0,
        },
        fetchedAt: "2026-06-01T00:00:00.000Z",
      } as const;
      cache.set("yahoo:options:AAPL:nearest", staleChain, -1);
      yahooFinanceMock.options.mockRejectedValue(new Error("yahoo-finance2 unavailable"));
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
        headers: new Headers(),
        text: () => Promise.resolve(""),
      });

      const chain = await getOptionsChain("AAPL");

      expect(yahooFinanceMock.options).toHaveBeenCalledWith("AAPL", undefined);
      expect(chain).toEqual(staleChain);
    });

    it("includes the yahoo-finance2 failure when every options fetch path fails", async () => {
      yahooFinanceMock.options.mockRejectedValue(new Error("yahoo-finance2 failed"));

      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (typeof url === "string" && url.includes("fc.yahoo.com")) {
          return Promise.resolve({
            ok: true,
            headers: new Headers({ "set-cookie": "A3=d=testcookie; Path=/" }),
            text: () => Promise.resolve(""),
          });
        }
        if (typeof url === "string" && url.includes("getcrumb")) {
          return Promise.resolve({
            ok: true,
            text: () => Promise.resolve("testCrumb"),
          });
        }
        return Promise.resolve({ ok: false, status: 429 });
      });

      await expect(getOptionsChain("AAPL")).rejects.toThrow(
        "Yahoo Finance options: HTTP 429; yahoo-finance2 fallback failed: yahoo-finance2 failed",
      );
    });
  });
});
