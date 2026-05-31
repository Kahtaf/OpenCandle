import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type Database from "better-sqlite3";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { MarketStateService } from "../../../src/market-state/service.js";

describe("MarketStateService", () => {
  let db: Database.Database;
  let service: MarketStateService;

  beforeEach(() => {
    db = initDatabase(":memory:");
    service = new MarketStateService(db);
  });

  afterEach(() => {
    db.close();
  });

  it("lazily creates one default watchlist and portfolio", () => {
    const watchlist = service.getDefaultWatchlist();
    const sameWatchlist = service.getDefaultWatchlist();
    const portfolio = service.getDefaultPortfolio();
    const samePortfolio = service.getDefaultPortfolio();

    expect(sameWatchlist.id).toBe(watchlist.id);
    expect(watchlist.name).toBe("Default");
    expect(samePortfolio.id).toBe(portfolio.id);
    expect(portfolio.name).toBe("Default");

    const watchlistCount = db.prepare("SELECT COUNT(*) AS n FROM watchlists").get() as { n: number };
    const portfolioCount = db.prepare("SELECT COUNT(*) AS n FROM portfolios").get() as { n: number };
    expect(watchlistCount.n).toBe(1);
    expect(portfolioCount.n).toBe(1);
  });

  it("adds or updates one watchlist row per instrument", () => {
    const first = service.addWatchlistItem({
      instrument: {
        symbol: "aapl",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      targetPrice: 250,
      notes: "Initial thesis",
    });

    const second = service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      stopPrice: 180,
      notes: "Updated thesis",
    });

    expect(second.id).toBe(first.id);
    expect(second.symbol).toBe("AAPL");
    expect(second.targetPrice).toBeNull();
    expect(second.stopPrice).toBe(180);
    expect(second.notes).toBe("Updated thesis");

    const itemCount = db.prepare("SELECT COUNT(*) AS n FROM watchlist_items").get() as { n: number };
    expect(itemCount.n).toBe(1);
  });

  it("stores portfolio lots under the default portfolio", () => {
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
      notes: "Core holding",
    });

    expect(lot.symbol).toBe("VTI");
    expect(lot.quantity).toBe(2);
    expect(lot.avgCost).toBe(250);
    expect(lot.currency).toBe("USD");

    const lots = service.listPortfolioLots();
    expect(lots).toHaveLength(1);
    expect(lots[0].symbol).toBe("VTI");
  });

  it("records predictions as open rows", () => {
    const prediction = service.recordPrediction({
      instrument: {
        symbol: "MSFT",
        assetType: "equity",
        name: "Microsoft Corporation",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      direction: "bullish",
      conviction: 8,
      entryPrice: 420,
      targetPrice: 480,
      timeframeDays: 30,
      now: new Date("2026-05-31T12:00:00.000Z"),
    });

    expect(prediction.symbol).toBe("MSFT");
    expect(prediction.status).toBe("open");
    expect(prediction.openedAt).toBe("2026-05-31T12:00:00.000Z");
    expect(prediction.expiresAt).toBe("2026-06-30T12:00:00.000Z");
  });
});
