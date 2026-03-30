import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getOptionsChain, getYahooCrumb, clearCrumbCache, computeTimeToExpiry } from "../../../src/providers/yahoo-finance.js";
import { cache } from "../../../src/infra/cache.js";
import optionsFixture from "../../fixtures/yahoo/options-AAPL.json";

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
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  describe("getYahooCrumb", () => {
    it("extracts crumb from consent redirect", async () => {
      globalThis.fetch = vi.fn()
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
      globalThis.fetch = vi.fn()
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
      expect(chain.calls.length).toBeGreaterThan(0);
      expect(chain.puts.length).toBeGreaterThan(0);
      expect(chain.expirationDates.length).toBeGreaterThan(0);
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
  });
});
