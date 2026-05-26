import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { getFundHoldings } from "../../../src/providers/yahoo-finance.js";
import type { FundHoldings } from "../../../src/types/portfolio.js";
import vooFixture from "../../fixtures/yahoo/VOO-holdings.json";

describe("Yahoo fund holdings provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("normalizes top holdings and sector weights from quoteSummary", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(vooFixture),
    });

    const holdings = await getFundHoldings("voo");

    expect(holdings.symbol).toBe("VOO");
    expect(holdings.name).toBe("Vanguard S&P 500 ETF");
    expect(holdings.holdings.slice(0, 3)).toEqual([
      { symbol: "AAPL", name: "Apple Inc.", weight: 0.072 },
      { symbol: "MSFT", name: "Microsoft Corp.", weight: 0.065 },
      { symbol: "NVDA", name: "NVIDIA Corp.", weight: 0.061 },
    ]);
    expect(holdings.sectorWeights).toEqual({
      technology: 0.31,
      communication_services: 0.09,
      consumer_cyclical: 0.10,
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("modules=price%2CtopHoldings"),
      expect.any(Object),
    );
  });

  it("throws the Yahoo quoteSummary error description when holdings are unavailable", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        quoteSummary: {
          result: null,
          error: { code: "Not Found", description: "No fundamentals data found" },
        },
      }),
    });

    await expect(getFundHoldings("MISSING")).rejects.toThrow("No fundamentals data found");
  });

  it("filters malformed holding weights and normalizes sector weights", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        quoteSummary: {
          result: [{
            price: { symbol: "ETF", shortName: "ETF" },
            topHoldings: {
              holdings: [
                { symbol: "AAPL", holdingName: "Apple", holdingPercent: 7.2 },
                { symbol: "MSFT", holdingName: "Microsoft", holdingPercent: 0 },
                { symbol: "NVDA", holdingName: "NVIDIA", holdingPercent: -1 },
                { symbol: "", holdingName: "Blank", holdingPercent: 2 },
              ],
              equityHoldings: {
                sectorWeightings: [
                  { technology: 31, healthcare: 0, energy: -2 },
                ],
              },
            },
          }],
          error: null,
        },
      }),
    });

    const holdings = await getFundHoldings("ETF");

    expect(holdings.holdings).toEqual([
      { symbol: "AAPL", name: "Apple", weight: 0.072 },
    ]);
    expect(holdings.sectorWeights).toEqual({ technology: 0.31 });
  });

  it("returns a stale cached holdings payload when the provider fails", async () => {
    const stale: FundHoldings = {
      symbol: "VOO",
      provider: "fixture",
      holdings: [{ symbol: "AAPL", name: "Apple", weight: 0.07 }],
    };
    cache.set("yahoo:fund-holdings:VOO", stale, -1);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        quoteSummary: {
          result: null,
          error: { description: "temporarily unavailable" },
        },
      }),
    });

    await expect(getFundHoldings("VOO")).resolves.toEqual(stale);
  });
});
