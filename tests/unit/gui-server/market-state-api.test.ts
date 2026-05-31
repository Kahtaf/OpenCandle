import { describe, it, expect, vi } from "vitest";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import {
  buildMarketStateSnapshot,
  searchInstrumentCandidates,
} from "../../../gui/server/market-state-api.js";
import { searchYahooInstruments } from "../../../src/market-state/resolve.js";

vi.mock("../../../src/market-state/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/market-state/resolve.js")>();
  return {
    ...actual,
    searchYahooInstruments: vi.fn(),
  };
});

describe("market-state API helpers", () => {
  it("builds a durable market-state snapshot from SQLite", () => {
    const db = initDatabase(":memory:");
    const service = new MarketStateService(db);
    service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
    });
    service.addPortfolioLot({
      instrument: {
        symbol: "VTI",
        assetType: "etf",
        name: "Vanguard Total Stock Market ETF",
        exchange: "PCX",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 2,
      avgCost: 250,
      currency: "USD",
    });

    const snapshot = buildMarketStateSnapshot(db);

    expect(snapshot.watchlist.map((item) => item.symbol)).toEqual(["AAPL"]);
    expect(snapshot.portfolio.map((lot) => lot.symbol)).toEqual(["VTI"]);
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.reportRuns).toEqual([]);
    db.close();
  });

  it("returns resolver candidates for GUI autocomplete", async () => {
    vi.mocked(searchYahooInstruments).mockResolvedValue([
      {
        symbol: "AAPL",
        name: "Apple Inc.",
        quoteType: "EQUITY",
        assetType: "equity",
        exchange: "NMS",
        provider: "yahoo",
        score: 101,
      },
    ]);

    await expect(searchInstrumentCandidates(" apple ")).resolves.toEqual({
      query: "apple",
      candidates: [
        {
          symbol: "AAPL",
          name: "Apple Inc.",
          quoteType: "EQUITY",
          assetType: "equity",
          exchange: "NMS",
          provider: "yahoo",
          score: 101,
        },
      ],
    });
  });
});
