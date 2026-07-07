import { beforeEach, describe, expect, it, vi } from "vitest";
import { compsTool } from "../../../src/tools/fundamentals/comps.js";

const { mockGetOverview, mockGetYahooCompanyOverview } = vi.hoisted(() => ({
  mockGetOverview: vi.fn(),
  mockGetYahooCompanyOverview: vi.fn(),
}));

vi.mock("../../../src/providers/alpha-vantage.js", () => ({
  getOverview: mockGetOverview,
}));

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getYahooCompanyOverview: mockGetYahooCompanyOverview,
}));

vi.mock("../../../src/config.js", () => ({
  getConfig: () => ({
    alphaVantageApiKey: "test-key",
  }),
}));

describe("compare_companies tool", () => {
  beforeEach(() => {
    mockGetOverview.mockReset();
    mockGetYahooCompanyOverview.mockReset();
    mockGetYahooCompanyOverview.mockRejectedValue(new Error("Yahoo Finance unavailable"));
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

  it("falls back to Yahoo fundamentals and reports per-symbol failure reasons", async () => {
    mockGetOverview.mockImplementation(async (symbol: string) => {
      if (symbol === "MU") throw new Error("Alpha Vantage rate limited");
      if (symbol === "DRAM") throw new Error("Alpha Vantage: No data found for DRAM");
      throw new Error(`unexpected ${symbol}`);
    });
    mockGetYahooCompanyOverview.mockImplementation(async (symbol: string) => {
      if (symbol === "MU") {
        return {
          symbol,
          name: "Micron Technology, Inc.",
          description: "",
          exchange: "NASDAQ",
          sector: "Technology",
          industry: "Semiconductors",
          marketCap: 1000,
          pe: 21,
          forwardPe: 15,
          eps: 6,
          dividendYield: 0.004,
          beta: 1.3,
          week52High: 150,
          week52Low: 80,
          avgVolume: 100,
          profitMargin: 0.22,
          revenueGrowth: 0.15,
        };
      }
      throw new Error(`Yahoo Finance: no company fundamentals returned for ${symbol}`);
    });

    const result = await compsTool.execute("comps-2", { symbols: ["MU", "DRAM"] });
    const text = (result.content[0] as any).text;

    expect(text).toContain("Comparable Company Analysis");
    expect(text).toContain("MU");
    expect(text).toContain("Unavailable fundamentals:");
    expect(text).toContain(
      "DRAM (Alpha Vantage: Alpha Vantage: No data found for DRAM; Yahoo Finance: Yahoo Finance: no company fundamentals returned for DRAM)",
    );
    expect(result.details.companies.map((company: any) => company.symbol)).toEqual(["MU"]);
    expect(result.details.unavailableSymbols).toEqual(["DRAM"]);
    expect(result.details.unavailableReasons.DRAM).toContain("Alpha Vantage");
  });
});
