import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../../src/infra/cache.js";
import {
  computeHoldingsOverlap,
  holdingsOverlapTool,
} from "../../../../src/tools/portfolio/holdings-overlap.js";
import type { FundHoldings } from "../../../../src/types/portfolio.js";
import qqqFixture from "../../../fixtures/yahoo/QQQ-holdings.json";
import vooFixture from "../../../fixtures/yahoo/VOO-holdings.json";

describe("holdings overlap", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("computes pairwise overlap by summing minimum shared holding weights", () => {
    const overlap = computeHoldingsOverlap([
      fund("VOO", [
        ["AAPL", 0.072],
        ["MSFT", 0.065],
        ["NVDA", 0.061],
      ]),
      fund("QQQ", [
        ["AAPL", 0.085],
        ["MSFT", 0.083],
        ["NVDA", 0.075],
      ]),
    ]);

    expect(overlap.pairs).toEqual([
      {
        symbols: ["VOO", "QQQ"],
        overlapWeight: 0.198,
        sharedHoldings: [
          {
            symbol: "AAPL",
            name: "AAPL",
            weights: { VOO: 0.072, QQQ: 0.085 },
            overlapWeight: 0.072,
          },
          {
            symbol: "MSFT",
            name: "MSFT",
            weights: { VOO: 0.065, QQQ: 0.083 },
            overlapWeight: 0.065,
          },
          {
            symbol: "NVDA",
            name: "NVDA",
            weights: { VOO: 0.061, QQQ: 0.075 },
            overlapWeight: 0.061,
          },
        ],
      },
    ]);
  });

  it("fetches fund holdings and returns structured tool details", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(vooFixture) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(qqqFixture) });

    const result = await holdingsOverlapTool.execute("tool-1", { symbols: ["VOO", "QQQ"] });

    expect(result.details?.pairs[0]?.overlapWeight).toBeCloseTo(0.198);
    expect(result.content[0]?.text).toContain("VOO/QQQ holdings overlap: 19.8%");
    expect(result.content[0]?.text).toContain("AAPL");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

function fund(symbol: string, holdings: Array<[string, number]>): FundHoldings {
  return {
    symbol,
    name: symbol,
    provider: "fixture",
    holdings: holdings.map(([holdingSymbol, weight]) => ({
      symbol: holdingSymbol,
      name: holdingSymbol,
      weight,
    })),
  };
}
