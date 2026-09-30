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
import afterHoursFixture from "../../fixtures/yahoo/options-AAPL-after-hours.json";
import holidayClosedFixture from "../../fixtures/yahoo/options-AAPL-holiday-closed.json";
import regularFixture from "../../fixtures/yahoo/options-AAPL-regular.json";

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
    // Stable Wednesday 10:00 AM ET — a weekday inside the NY regular options
    // session. Freezing "now" here keeps quote-status branches independent of
    // the wall clock; tests below override the time for other sessions.
    const REGULAR_SESSION = new Date("2026-05-20T14:00:00.000Z");
    beforeEach(() => {
      // Fake only the clock; keep timers real so the rate limiter and fetch
      // scheduling behave like production.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(REGULAR_SESSION);
      // Re-anchor the shared bucket to the frozen clock; otherwise its
      // module-load "last refill" stays on the real wall clock and a negative
      // elapsed time makes acquire() wait for an absurd duration.
      rateLimiter.configure("yahoo", 5, 5);
    });

    function mockCrumbAndOptions(fixture: typeof optionsFixture = optionsFixture) {
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
          json: () => Promise.resolve(fixture),
        });
      });
    }

    function zeroBidAskFixture(fixture: typeof optionsFixture): typeof optionsFixture {
      for (const contract of fixture.optionChain.result[0].options[0].calls) {
        contract.bid = 0;
        contract.ask = 0;
      }
      for (const contract of fixture.optionChain.result[0].options[0].puts) {
        contract.bid = 0;
        contract.ask = 0;
      }
      return fixture;
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

    type SessionCase = {
      name: string;
      utc: string;
      allZeroBidAsk: boolean;
      marketSession: "pre_market" | "regular" | "after_hours" | "closed";
      bidAskState:
        | "live_quotes"
        | "last_session_quotes"
        | "closed_market_or_stale_quotes"
        | "live_zero_bid_ask"
        | "mixed_or_unknown";
      warningContains?: string;
      expectWarning: boolean;
    };

    const SESSION_CASES: SessionCase[] = [
      {
        name: "pre-market all-zero quotes are closed-market stale",
        utc: "2026-05-20T12:26:00.000Z", // 8:26 AM EDT
        allZeroBidAsk: true,
        marketSession: "pre_market",
        bidAskState: "closed_market_or_stale_quotes",
        warningContains: "before regular options trading",
        expectWarning: true,
      },
      {
        name: "after-hours all-zero quotes are closed-market stale",
        utc: "2026-05-20T20:26:00.000Z", // 4:26 PM EDT
        allZeroBidAsk: true,
        marketSession: "after_hours",
        bidAskState: "closed_market_or_stale_quotes",
        warningContains: "outside market hours",
        expectWarning: true,
      },
      {
        name: "regular-session all-zero quotes are live illiquidity, not stale",
        utc: "2026-05-20T14:00:00.000Z", // 10:00 AM EDT
        allZeroBidAsk: true,
        marketSession: "regular",
        bidAskState: "live_zero_bid_ask",
        warningContains: "during regular options trading hours",
        expectWarning: true,
      },
      {
        name: "regular-session live quotes carry no stale warning",
        utc: "2026-05-20T14:00:00.000Z", // 10:00 AM EDT
        allZeroBidAsk: false,
        marketSession: "regular",
        bidAskState: "live_quotes",
        expectWarning: false,
      },
      {
        name: "after-hours nonzero quotes are last-session, not live",
        utc: "2026-05-20T20:26:00.000Z", // 4:26 PM EDT
        allZeroBidAsk: false,
        marketSession: "after_hours",
        bidAskState: "last_session_quotes",
        warningContains: "not executable",
        expectWarning: true,
      },
      {
        name: "weekend quotes report the closed session",
        utc: "2026-05-23T14:00:00.000Z", // Saturday 10:00 AM EDT
        allZeroBidAsk: true,
        marketSession: "closed",
        bidAskState: "closed_market_or_stale_quotes",
        warningContains: "outside market hours",
        expectWarning: true,
      },
    ];

    it.each(SESSION_CASES)("$name", async (c) => {
      vi.setSystemTime(new Date(c.utc));
      rateLimiter.configure("yahoo", 5, 5);
      const fixture = structuredClone(optionsFixture);
      if (c.allZeroBidAsk) zeroBidAskFixture(fixture);
      mockCrumbAndOptions(fixture);

      const chain = await getOptionsChain("AAPL");

      expect(chain.quoteStatus.marketSession).toBe(c.marketSession);
      expect(chain.quoteStatus.bidAskState).toBe(c.bidAskState);
      if (c.expectWarning) {
        expect(chain.quoteStatus.warning).toContain(c.warningContains);
      } else {
        expect(chain.quoteStatus.warning).toBeUndefined();
      }
    });

    it.each([
      { et: "09:29", utc: "2026-05-20T13:29:00.000Z", expected: "pre_market" },
      { et: "09:30", utc: "2026-05-20T13:30:00.000Z", expected: "regular" },
      { et: "15:59", utc: "2026-05-20T19:59:00.000Z", expected: "regular" },
      { et: "16:00", utc: "2026-05-20T20:00:00.000Z", expected: "after_hours" },
    ])("classifies $et ET as $expected", async ({ utc, expected }) => {
      vi.setSystemTime(new Date(utc));
      rateLimiter.configure("yahoo", 5, 5);
      mockCrumbAndOptions();

      const chain = await getOptionsChain("AAPL");

      expect(chain.quoteStatus.marketSession).toBe(expected);
    });

    describe("session from Yahoo marketState", () => {
      async function chainAt(utc: string, fixture: unknown) {
        vi.setSystemTime(new Date(utc));
        rateLimiter.configure("yahoo", 5, 5);
        mockCrumbAndOptions(structuredClone(fixture) as typeof optionsFixture);
        return getOptionsChain("AAPL");
      }

      it("reserves live_quotes for a REGULAR marketState with nonzero bid/ask", async () => {
        const chain = await chainAt("2026-05-20T15:00:00.000Z", regularFixture);

        expect(chain.quoteStatus.marketSession).toBe("regular");
        expect(chain.quoteStatus.marketSessionSource).toBe("provider_market_state");
        expect(chain.quoteStatus.providerMarketState).toBe("REGULAR");
        expect(chain.quoteStatus.bidAskState).toBe("live_quotes");
        expect(chain.quoteStatus.warning).toBeUndefined();
      });

      it("labels nonzero after-hours bid/ask as last-session quotes, not live", async () => {
        // 10:05 PM EDT, same trading day as the fixture's last contract trades.
        const chain = await chainAt("2026-05-21T02:05:00.000Z", afterHoursFixture);

        expect(chain.quoteStatus.marketSession).toBe("after_hours");
        expect(chain.quoteStatus.providerMarketState).toBe("POST");
        expect(chain.quoteStatus.bidAskState).toBe("last_session_quotes");
        expect(chain.quoteStatus.warning).toContain("not executable");
        expect(chain.quoteStatus.warning).toContain("No bid/ask midpoint is a live premium");
        expect(chain.quoteStatus.latestContractTradeAt).toBe("2026-05-20T19:59:00.000Z");
      });

      it("trusts a CLOSED marketState on a weekday holiday over the wall clock", async () => {
        // Monday 10:00 AM EDT: the wall clock alone would call this regular.
        const chain = await chainAt("2026-05-25T14:00:00.000Z", holidayClosedFixture);

        expect(chain.quoteStatus.marketSession).toBe("closed");
        expect(chain.quoteStatus.marketSessionSource).toBe("provider_market_state");
        expect(chain.quoteStatus.bidAskState).toBe("last_session_quotes");
        expect(chain.quoteStatus.latestContractTradeAt).toBe("2026-05-22T19:59:00.000Z");
      });

      it.each([
        { state: "PRE", expected: "pre_market" },
        { state: "PREPRE", expected: "pre_market" },
        { state: "POSTPOST", expected: "after_hours" },
      ])("maps marketState $state to $expected", async ({ state, expected }) => {
        const fixture = structuredClone(regularFixture);
        fixture.optionChain.result[0].quote.marketState = state;
        const chain = await chainAt("2026-05-20T15:00:00.000Z", fixture);

        expect(chain.quoteStatus.marketSession).toBe(expected);
        expect(chain.quoteStatus.bidAskState).toBe("last_session_quotes");
      });

      it("falls back to the local calendar when marketState is unrecognized", async () => {
        const fixture = structuredClone(regularFixture);
        fixture.optionChain.result[0].quote.marketState = "SOMETHING_NEW";
        const chain = await chainAt("2026-05-21T02:05:00.000Z", fixture);

        expect(chain.quoteStatus.marketSession).toBe("after_hours");
        expect(chain.quoteStatus.marketSessionSource).toBe("local_calendar");
        expect(chain.quoteStatus.providerMarketState).toBe("SOMETHING_NEW");
        expect(chain.quoteStatus.bidAskState).toBe("last_session_quotes");
      });

      it("uses the holiday-aware calendar when marketState is missing", async () => {
        const fixture = structuredClone(holidayClosedFixture) as Record<string, any>;
        delete fixture.optionChain.result[0].quote.marketState;
        // Memorial Day, Monday 10:00 AM EDT.
        const chain = await chainAt("2026-05-25T14:00:00.000Z", fixture);

        expect(chain.quoteStatus.marketSession).toBe("closed");
        expect(chain.quoteStatus.marketSessionSource).toBe("local_calendar");
        expect(chain.quoteStatus.providerMarketState).toBeUndefined();
      });

      it("does not serve a cached REGULAR chain as live after the regular session closes", async () => {
        // 3:59 PM EDT fetch, cached for the options TTL.
        const first = await chainAt("2026-05-20T19:59:00.000Z", regularFixture);
        expect(first.quoteStatus.bidAskState).toBe("live_quotes");

        // 4:00 PM EDT: still within the cache TTL, but the regular session is over.
        vi.setSystemTime(new Date("2026-05-20T20:00:00.000Z"));
        const cached = await getOptionsChain("AAPL");

        expect(cached.quoteStatus.marketSession).toBe("after_hours");
        expect(cached.quoteStatus.marketSessionSource).toBe("local_calendar_recheck");
        expect(cached.quoteStatus.providerMarketState).toBe("REGULAR");
        expect(cached.quoteStatus.bidAskState).toBe("last_session_quotes");
        expect(cached.quoteStatus.warning).toContain("not executable");
      });

      it("does not serve a stale-cache REGULAR chain as live after the close when refetch fails", async () => {
        await chainAt("2026-05-20T19:59:00.000Z", regularFixture);

        // 4:20 PM EDT: past the fresh TTL; every fetch path fails, so the stale chain is used.
        vi.setSystemTime(new Date("2026-05-20T20:20:00.000Z"));
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));
        yahooFinanceMock.options.mockRejectedValue(new Error("fallback down"));
        const stale = await getOptionsChain("AAPL");

        expect(stale.quoteStatus.marketSession).toBe("after_hours");
        expect(stale.quoteStatus.bidAskState).toBe("last_session_quotes");
      });

      it("keeps a cached REGULAR chain live while the regular session is still open", async () => {
        await chainAt("2026-05-20T15:00:00.000Z", regularFixture);
        vi.setSystemTime(new Date("2026-05-20T15:01:00.000Z"));
        const cached = await getOptionsChain("AAPL");

        expect(cached.quoteStatus.marketSessionSource).toBe("provider_market_state");
        expect(cached.quoteStatus.bidAskState).toBe("live_quotes");
      });

      it("maps each contract's lastTradeDate to an ISO timestamp", async () => {
        const chain = await chainAt("2026-05-21T02:05:00.000Z", afterHoursFixture);

        expect(chain.calls[0].lastTradeDate).toBe("2026-05-20T19:59:00.000Z");
        expect(chain.calls[1].lastTradeDate).toBe("2026-05-20T19:52:00.000Z");
        expect(chain.puts[0].lastTradeDate).toBe("2026-05-20T19:59:00.000Z");
      });

      it("maps Date lastTradeDate values from the yahoo-finance2 fallback", async () => {
        vi.setSystemTime(new Date("2026-05-21T02:05:00.000Z"));
        rateLimiter.configure("yahoo", 5, 5);
        globalThis.fetch = vi.fn().mockRejectedValue(new Error("blocked"));
        const raw = afterHoursFixture.optionChain.result[0];
        const toDate = (c: { lastTradeDate: number }) => ({
          ...c,
          lastTradeDate: new Date(c.lastTradeDate * 1000),
        });
        yahooFinanceMock.options.mockResolvedValue({
          underlyingSymbol: raw.underlyingSymbol,
          expirationDates: raw.expirationDates.map((t) => new Date(t * 1000)),
          quote: raw.quote,
          options: [
            {
              expirationDate: new Date(raw.options[0].expirationDate * 1000),
              calls: raw.options[0].calls.map(toDate),
              puts: raw.options[0].puts.map(toDate),
            },
          ],
        });

        const chain = await getOptionsChain("AAPL");

        expect(chain.calls[0].lastTradeDate).toBe("2026-05-20T19:59:00.000Z");
        expect(chain.quoteStatus.bidAskState).toBe("last_session_quotes");
      });
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
          marketSessionSource: "local_calendar",
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
