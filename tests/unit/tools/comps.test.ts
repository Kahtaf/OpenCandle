import { beforeEach, describe, expect, it, vi } from "vitest";
import { compsTool } from "../../../src/tools/fundamentals/comps.js";

const { mockGetOverview } = vi.hoisted(() => ({
  mockGetOverview: vi.fn(),
}));

vi.mock("../../../src/providers/alpha-vantage.js", () => ({
  getOverview: mockGetOverview,
}));

vi.mock("../../../src/config.js", () => ({
  getConfig: () => ({
    alphaVantageApiKey: "test-key",
  }),
}));

describe("compare_companies tool", () => {
  beforeEach(() => {
    mockGetOverview.mockReset();
  });

  it("returns partial results when one symbol is unavailable", async () => {
    mockGetOverview.mockImplementation(async (symbol: string) => {
      if (symbol === "MSFT") {
        throw new Error("Alpha Vantage: No data found for MSFT");
      }

      return {
        symbol,
        name: `${symbol} Inc`,
        description: "",
        exchange: "NASDAQ",
        sector: "Tech",
        industry: "Software",
        marketCap: 100,
        pe: 20,
        forwardPe: 18,
        eps: 5,
        dividendYield: 0.01,
        beta: 1.1,
        week52High: 200,
        week52Low: 100,
        avgVolume: 1000,
        profitMargin: 0.25,
        revenueGrowth: 0.1,
      };
    });

    const result = await compsTool.execute("comps-1", { symbols: ["AAPL", "MSFT"] });
    const text = (result.content[0] as any).text;

    expect(text).toContain("AAPL");
    expect(text).toContain("Unavailable fundamentals: MSFT");
    expect(result.details.unavailableSymbols).toEqual(["MSFT"]);
  });
});
