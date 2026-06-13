import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDatabase } from "../../../src/memory/sqlite.js";

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

    const watchlistCount = db.prepare("SELECT COUNT(*) AS n FROM watchlists").get() as {
      n: number;
    };
    const portfolioCount = db.prepare("SELECT COUNT(*) AS n FROM portfolios").get() as {
      n: number;
    };
    expect(watchlistCount.n).toBe(1);
    expect(portfolioCount.n).toBe(1);
  });

  it("keeps lazy default rows singular across multiple sqlite connections", () => {
    const base = mkdtempSync(join(tmpdir(), "opencandle-market-state-defaults-"));
    const dbPath = join(base, "state.db");
    const firstDb = initDatabase(dbPath);
    const secondDb = initDatabase(dbPath);

    try {
      const firstService = new MarketStateService(firstDb);
      const secondService = new MarketStateService(secondDb);

      const firstWatchlist = firstService.getDefaultWatchlist();
      const secondWatchlist = secondService.getDefaultWatchlist();
      const firstPortfolio = firstService.getDefaultPortfolio();
      const secondPortfolio = secondService.getDefaultPortfolio();

      expect(secondWatchlist.id).toBe(firstWatchlist.id);
      expect(secondPortfolio.id).toBe(firstPortfolio.id);

      const watchlistCount = firstDb.prepare("SELECT COUNT(*) AS n FROM watchlists").get() as {
        n: number;
      };
      const portfolioCount = firstDb.prepare("SELECT COUNT(*) AS n FROM portfolios").get() as {
        n: number;
      };
      expect(watchlistCount.n).toBe(1);
      expect(portfolioCount.n).toBe(1);
    } finally {
      firstDb.close();
      secondDb.close();
      rmSync(base, { recursive: true, force: true });
    }
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
    expect(second.targetPrice).toBe(250);
    expect(second.stopPrice).toBe(180);
    expect(second.notes).toBe("Updated thesis");

    const itemCount = db.prepare("SELECT COUNT(*) AS n FROM watchlist_items").get() as {
      n: number;
    };
    expect(itemCount.n).toBe(1);
  });

  it("preserves watchlist metadata when a duplicate add only supplies the instrument", () => {
    const first = service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      targetPrice: 260,
      stopPrice: 175,
      thesis: "Services growth",
      notes: "Core watch",
      tags: ["mega-cap", "quality"],
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
    });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      targetPrice: 260,
      stopPrice: 175,
      thesis: "Services growth",
      notes: "Core watch",
      tags: ["mega-cap", "quality"],
    });
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

  it("rejects non-positive or non-finite portfolio lot quantities and costs", () => {
    const instrument = {
      symbol: "VTI",
      assetType: "etf" as const,
      name: "Vanguard Total Stock Market ETF",
      exchange: "PCX",
      currency: "USD",
      provider: "yahoo",
    };

    expect(() =>
      service.addPortfolioLot({
        instrument,
        quantity: 0,
        avgCost: 250,
        currency: "USD",
      }),
    ).toThrow("Portfolio lot quantity must be a positive finite number.");
    expect(() =>
      service.addPortfolioLot({
        instrument,
        quantity: 1,
        avgCost: -1,
        currency: "USD",
      }),
    ).toThrow("Portfolio lot average cost must be a positive finite number.");
    expect(() =>
      service.addPortfolioLot({
        instrument,
        quantity: Number.NaN,
        avgCost: 250,
        currency: "USD",
      }),
    ).toThrow("Portfolio lot quantity must be a positive finite number.");

    const lot = service.addPortfolioLot({
      instrument,
      quantity: 1,
      avgCost: 250,
      currency: "USD",
    });
    expect(() => service.updatePortfolioLot(lot.id, { avgCost: 0 })).toThrow(
      "Portfolio lot average cost must be a positive finite number.",
    );
    expect(service.updatePortfolioLot(lot.id, { notes: "kept" })?.notes).toBe("kept");
  });

  it("represents import provenance on import rows and saved market-state rows", () => {
    const batch = service.recordImportBatch({
      source: "tradingview",
      sourceLabel: "TradingView watchlist export",
      importedAt: "2026-05-31T13:00:00.000Z",
      status: "completed",
      rawMetadata: { filename: "watchlist.csv" },
    });
    const importRow = service.recordImportRow({
      batchId: batch.id,
      rowType: "watchlist_item",
      sourceSymbol: "NASDAQ:AAPL",
      sourceRowId: "tv-row-1",
      status: "imported",
      raw: { Symbol: "NASDAQ:AAPL" },
      sourceMetadata: { watchlist: "Growth" },
    });

    const watchlistItem = service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      source: "tradingview",
      sourceRowId: importRow.sourceRowId ?? undefined,
      sourceMetadata: { importRowId: importRow.id },
    });
    const portfolioLot = service.addPortfolioLot({
      instrument: {
        symbol: "IBKR",
        assetType: "equity",
        name: "Interactive Brokers Group, Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 4,
      avgCost: 100,
      currency: "USD",
      source: "interactive_brokers",
      sourceAccountRef: "account-ending-1234",
      sourceLotId: "lot-9",
      sourceRowId: "ib-row-9",
      sourceMetadata: { importRowId: 9 },
    });

    expect(batch.rawMetadata).toEqual({ filename: "watchlist.csv" });
    expect(importRow).toMatchObject({
      sourceRowId: "tv-row-1",
      sourceMetadata: { watchlist: "Growth" },
      raw: { Symbol: "NASDAQ:AAPL" },
    });
    expect(watchlistItem).toMatchObject({
      source: "tradingview",
      sourceRowId: "tv-row-1",
      sourceMetadata: { importRowId: importRow.id },
    });
    expect(portfolioLot).toMatchObject({
      source: "interactive_brokers",
      sourceAccountRef: "account-ending-1234",
      sourceLotId: "lot-9",
      sourceRowId: "ib-row-9",
      sourceMetadata: { importRowId: 9 },
    });
  });

  it("stores source-native aliases for future import reconciliation", () => {
    const item = service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
        aliases: [
          {
            source: "tradingview",
            sourceSymbol: "NASDAQ:AAPL",
            sourceExchange: "NASDAQ",
            sourceAssetType: "stock",
            sourceId: "tv-symbol-apple",
            raw: { Symbol: "NASDAQ:AAPL" },
          },
          {
            source: "interactive_brokers",
            sourceSymbol: "AAPL",
            sourceExchange: "NASDAQ",
            sourceAssetType: "stock",
            raw: { conid: "265598" },
          },
        ],
      },
    });

    expect(
      service.findInstrumentByAlias({
        source: "tradingview",
        sourceSymbol: "NASDAQ:AAPL",
        sourceId: "tv-symbol-apple",
      })?.id,
    ).toBe(item.instrumentId);
    expect(
      service.findInstrumentByAlias({
        source: "interactive_brokers",
        sourceSymbol: "AAPL",
        sourceExchange: "NASDAQ",
        sourceAssetType: "stock",
      })?.id,
    ).toBe(item.instrumentId);
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

  it("updates prediction outcome status and result metadata", () => {
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
      timeframeDays: 30,
      now: new Date("2026-01-01T12:00:00.000Z"),
    });

    const updated = service.updatePredictionOutcome({
      id: prediction.id,
      status: "resolved",
      resolvedAt: "2026-02-01T12:00:00.000Z",
      result: { currentPrice: 450, correct: true },
    });

    expect(updated.status).toBe("resolved");
    expect(updated.resolvedAt).toBe("2026-02-01T12:00:00.000Z");
    expect(updated.resultJson).toBe(JSON.stringify({ currentPrice: 450, correct: true }));
  });
});
