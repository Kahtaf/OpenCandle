import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getOptionsChain, getYahooCrumb, clearCrumbCache } from "../../../src/providers/yahoo-finance.js";
import { cache } from "../../../src/infra/cache.js";
import optionsFixture from "../../fixtures/yahoo/options-AAPL.json";

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
