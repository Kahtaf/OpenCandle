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
    expect(second.symbol).toBe("AAPL");

    const itemCount = db.prepare("SELECT COUNT(*) AS n FROM watchlist_items").get() as {
      n: number;
    };
    expect(itemCount.n).toBe(1);
  });

  it("stores symbols in separate named watchlists", () => {
    const mag7 = service.createWatchlist("MAG7");
    const etfs = service.createWatchlist("ETFs");

    service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      watchlistId: mag7.id,
    });
    service.addWatchlistItem({
      instrument: {
        symbol: "VOO",
        assetType: "etf",
        name: "Vanguard S&P 500 ETF",
        exchange: "PCX",
        currency: "USD",
        provider: "yahoo",
      },
      watchlistId: etfs.id,
    });

    expect(service.listWatchlists().map((watchlist) => watchlist.name)).toEqual([
      "Default",
      "ETFs",
      "MAG7",
    ]);
    expect(service.listWatchlistItems(mag7.id).map((item) => item.symbol)).toEqual(["AAPL"]);
    expect(service.listWatchlistItems(etfs.id).map((item) => item.symbol)).toEqual(["VOO"]);

    expect(service.removeWatchlistItemBySymbol("AAPL", mag7.id)).toBe(true);

    expect(service.listWatchlistItems(mag7.id)).toEqual([]);
    expect(service.listWatchlistItems(etfs.id).map((item) => item.symbol)).toEqual(["VOO"]);
  });

  it("removes a watchlist item by stable row identity", () => {
    const watchlist = service.getDefaultWatchlist();
    const item = service.addWatchlistItem({
      watchlistId: watchlist.id,
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        provider: "test",
      },
    });

    expect(service.removeWatchlistItem(item.id, watchlist.id)).toBe(true);
    expect(service.removeWatchlistItem(item.id, watchlist.id)).toBe(false);
  });

  it("renames a watchlist without moving its symbols", () => {
    const growth = service.createWatchlist("Growth");
    service.addWatchlistItem({
      instrument: {
        symbol: "NVDA",
        assetType: "equity",
        name: "NVIDIA Corporation",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      watchlistId: growth.id,
    });

    const renamed = service.renameWatchlist("Growth", "AI");

    expect(renamed).toMatchObject({ id: growth.id, name: "AI", isDefault: false });
    expect(service.getWatchlistByName("Growth")).toBeNull();
    expect(service.listWatchlistItems(renamed.id).map((item) => item.symbol)).toEqual(["NVDA"]);
    expect(service.listWatchlists().map((watchlist) => watchlist.name)).toEqual(["Default", "AI"]);
  });

  it("deletes a watchlist, promotes another list, and keeps its other symbols intact", () => {
    service.createWatchlist("Growth");
    const etfs = service.createWatchlist("ETFs");

    const selected = service.deleteWatchlist("Default");

    expect(selected).toMatchObject({ id: etfs.id, name: "ETFs", isDefault: true });
    expect(service.getWatchlistByName("Default")).toBeNull();
    expect(service.listWatchlists().map((watchlist) => watchlist.name)).toEqual(["ETFs", "Growth"]);
  });

  it("does not delete the final remaining watchlist", () => {
    expect(() => service.deleteWatchlist("Default")).toThrow(
      "cannot delete the last remaining watchlist.",
    );
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

  it("stores lots in separate named portfolios and renames a portfolio without moving lots", () => {
    const retirement = service.createPortfolio("Retirement");
    const trading = service.createPortfolio("Trading");

    service.addPortfolioLot({
      portfolioId: retirement.id,
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
    service.addPortfolioLot({
      portfolioId: trading.id,
      instrument: {
        symbol: "TSLA",
        assetType: "equity",
        name: "Tesla, Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 1,
      avgCost: 200,
      currency: "USD",
    });

    const renamed = service.renamePortfolio("Trading", "Speculative");

    expect(service.listPortfolios().map((portfolio) => portfolio.name)).toEqual([
      "Default",
      "Retirement",
      "Speculative",
    ]);
    expect(renamed).toMatchObject({ id: trading.id, name: "Speculative", baseCurrency: "USD" });
    expect(service.getPortfolioByName("Trading")).toBeNull();
    expect(service.listPortfolioLots(retirement.id).map((lot) => lot.symbol)).toEqual(["VTI"]);
    expect(service.listPortfolioLots(renamed.id).map((lot) => lot.symbol)).toEqual(["TSLA"]);
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
});
