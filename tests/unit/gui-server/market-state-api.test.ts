import { describe, it, expect, vi } from "vitest";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import {
  buildMarketStateSnapshot,
  buildMarketStateQuoteSnapshot,
  searchInstrumentCandidates,
} from "../../../gui/server/market-state-api.js";
import { searchYahooInstruments } from "../../../src/market-state/resolve.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import type { StockQuote } from "../../../src/types/market.js";

vi.mock("../../../src/market-state/resolve.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/market-state/resolve.js")>();
  return {
    ...actual,
    searchYahooInstruments: vi.fn(),
  };
});
vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

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

  it("builds explicit quote snapshots for watchlist and portfolio rows", async () => {
    const db = initDatabase(":memory:");
    const service = new MarketStateService(db);
    const watchlist = service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
    });
    const lot = service.addPortfolioLot({
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
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      quote(symbol, symbol === "AAPL" ? 190 : 300),
    );

    const snapshot = await buildMarketStateQuoteSnapshot(db);

    expect(snapshot.watchlistQuotes).toEqual([
      expect.objectContaining({
        itemId: watchlist.id,
        symbol: "AAPL",
        status: "ok",
        price: 190,
      }),
    ]);
    expect(snapshot.portfolioQuotes).toEqual([
      expect.objectContaining({
        lotId: lot.id,
        symbol: "VTI",
        status: "ok",
        currentPrice: 300,
        marketValue: 600,
        pnl: 100,
      }),
    ]);
    expect(snapshot.portfolioSummary).toMatchObject({
      baseCurrency: "USD",
      totalValue: 600,
      totalCost: 500,
      totalPnl: 100,
    });
    db.close();
  });
});

function quote(symbol: string, price: number): StockQuote {
  return {
    symbol,
    price,
    change: 1,
    changePercent: 0.5,
    open: price - 1,
    high: price + 1,
    low: price - 2,
    previousClose: price - 1,
    volume: 1_000,
    marketCap: 0,
    pe: null,
    week52High: price + 10,
    week52Low: price - 10,
    timestamp: Date.now(),
  };
}
