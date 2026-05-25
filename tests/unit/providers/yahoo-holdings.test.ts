import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { getFundHoldings } from "../../../src/providers/yahoo-finance.js";
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
});
