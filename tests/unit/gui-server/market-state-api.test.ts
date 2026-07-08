import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMarketStateQuoteSnapshot,
  buildMarketStateSnapshot,
  createSavedSymbolsMemo,
  searchInstrumentCandidates,
} from "../../../gui/server/market-state-api.js";
import { cache } from "../../../src/infra/cache.js";
import { searchYahooInstruments } from "../../../src/market-state/resolve.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDatabase } from "../../../src/memory/sqlite.js";
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
  beforeEach(() => {
    cache.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    cache.clear();
    vi.clearAllMocks();
  });

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
    service.acquireAutomationRunnerLease({
      ownerId: "gui-1",
      ownerKind: "writer",
      now: "2026-06-01T12:00:00.000Z",
      ttlSeconds: 60,
    });
    const checkRun = service.startAlertCheckRun({
      ownerId: "gui-1",
      triggerType: "manual",
      startedAt: "2026-06-01T12:00:01.000Z",
    });
    service.completeAlertCheckRun(checkRun.id, {
      status: "completed",
      completedAt: "2026-06-01T12:00:02.000Z",
      checkedCount: 1,
      triggeredCount: 0,
      unavailableCount: 0,
    });
    const notification = service.recordNotificationEvent({
      sourceType: "alert_event",
      sourceId: 1,
      severity: "info",
      title: "Alert checked",
      body: "No trigger.",
      createdAt: "2026-06-01T12:00:03.000Z",
    });
    service.recordNotificationDeliveryAttempt({
      notificationEventId: notification.id,
      channel: "webhook",
      status: "failed",
      attemptedAt: "2026-06-01T12:00:04.000Z",
      error: "connection refused",
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-01T12:00:30.000Z"));
    const snapshot = buildMarketStateSnapshot(db);

    expect(snapshot.portfolios.map((portfolio) => portfolio.name)).toEqual(["Default"]);
    expect(snapshot.watchlist.map((item) => item.symbol)).toEqual(["AAPL"]);
    expect(snapshot.portfolio.map((lot) => lot.symbol)).toEqual(["VTI"]);
    expect(snapshot.alerts).toEqual([]);
    expect(snapshot.reportRuns).toEqual([]);
    expect(snapshot.runnerLease).toMatchObject({ ownerId: "gui-1", ownerKind: "writer" });
    expect(snapshot.alertCheckRuns).toEqual([
      expect.objectContaining({ id: checkRun.id, status: "completed", checkedCount: 1 }),
    ]);
    expect(snapshot.notifications).toEqual([
      expect.objectContaining({ id: notification.id, title: "Alert checked" }),
    ]);
    expect(snapshot.notificationDeliveryAttempts).toEqual([
      expect.objectContaining({
        notificationEventId: notification.id,
        channel: "webhook",
        status: "failed",
      }),
    ]);
    db.close();
  });

  it("memoizes saved symbols for 30 seconds", () => {
    let calls = 0;
    let now = 1_000;
    const memo = createSavedSymbolsMemo(
      () => {
        calls += 1;
        return [`SYM${calls}`];
      },
      { ttlMs: 30_000, now: () => now },
    );

    expect(memo()).toEqual(["SYM1"]);
    expect(memo()).toEqual(["SYM1"]);

    now += 30_000;
    expect(memo()).toEqual(["SYM2"]);
    expect(calls).toBe(2);
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

  it("returns an empty autocomplete result when provider search fails", async () => {
    vi.mocked(searchYahooInstruments).mockRejectedValueOnce(new Error("rate limited"));

    await expect(searchInstrumentCandidates(" apple ")).resolves.toEqual({
      query: "apple",
      candidates: [],
      error: "rate limited",
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
    const secondLot = service.addPortfolioLot({
      instrument: {
        symbol: "MSFT",
        assetType: "equity",
        name: "Microsoft Corporation",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 1,
      avgCost: 350,
      currency: "USD",
    });
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      quote(symbol, symbol === "AAPL" ? 190 : symbol === "MSFT" ? 400 : 300),
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
        allocationPercent: 60,
      }),
      expect.objectContaining({
        lotId: secondLot.id,
        symbol: "MSFT",
        status: "ok",
        currentPrice: 400,
        marketValue: 400,
        pnl: 50,
        allocationPercent: 40,
      }),
    ]);
    expect(snapshot.portfolioSummary).toMatchObject({
      baseCurrency: "USD",
      totalValue: 1000,
      totalCost: 850,
      totalPnl: 150,
    });
    db.close();
  });

  it("builds quote snapshots and summaries across named portfolios", async () => {
    const db = initDatabase(":memory:");
    const service = new MarketStateService(db);
    const trading = service.createPortfolio("Trading");
    const defaultLot = service.addPortfolioLot({
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
    const tradingLot = service.addPortfolioLot({
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
    vi.mocked(getQuote).mockImplementation(async (symbol: string) =>
      quote(symbol, symbol === "TSLA" ? 300 : 275),
    );

    const snapshot = await buildMarketStateQuoteSnapshot(db);

    expect(snapshot.portfolioQuotes).toEqual([
      expect.objectContaining({
        lotId: defaultLot.id,
        symbol: "VTI",
        marketValue: 550,
        allocationPercent: 100,
      }),
      expect.objectContaining({
        lotId: tradingLot.id,
        symbol: "TSLA",
        marketValue: 300,
        allocationPercent: 100,
      }),
    ]);
    expect(snapshot.portfolioSummary).toMatchObject({ totalValue: 550 });
    expect(snapshot.portfolioSummaries).toEqual([
      expect.objectContaining({ portfolioId: defaultLot.portfolioId, totalValue: 550 }),
      expect.objectContaining({ portfolioId: trading.id, totalValue: 300 }),
    ]);
    db.close();
  });

  it("marks stale quote snapshot rows unavailable and excludes them from portfolio totals", async () => {
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
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 2,
      avgCost: 150,
      currency: "USD",
    });
    cache.set("test-stale-market-state-api-quote", quote("AAPL", 200), -1);
    vi.mocked(getQuote).mockImplementation(async () => {
      cache.getStale("test-stale-market-state-api-quote", 60_000);
      return quote("AAPL", 200);
    });

    const snapshot = await buildMarketStateQuoteSnapshot(db);

    expect(snapshot.watchlistQuotes).toEqual([
      expect.objectContaining({
        itemId: watchlist.id,
        symbol: "AAPL",
        status: "unavailable",
        reason: "provider returned stale market data",
      }),
    ]);
    expect(snapshot.portfolioQuotes).toEqual([
      expect.objectContaining({
        lotId: lot.id,
        symbol: "AAPL",
        status: "unavailable",
        reason: "provider returned stale market data",
        includedInTotals: false,
      }),
    ]);
    expect(snapshot.portfolioSummary).toMatchObject({
      totalValue: 0,
      totalCost: 0,
      excludedFromTotals: [
        expect.objectContaining({ symbol: "AAPL", reason: "provider returned stale market data" }),
      ],
    });
    db.close();
  });

  it("marks stale provider as-of quote snapshot rows unavailable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-06T14:00:00.000Z"));
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
        symbol: "AAPL",
        assetType: "equity",
        name: "Apple Inc.",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 2,
      avgCost: 150,
      currency: "USD",
    });
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 200, { asOf: "2026-07-02T20:00:00.000Z" }));

    const snapshot = await buildMarketStateQuoteSnapshot(db);

    expect(snapshot.watchlistQuotes).toEqual([
      expect.objectContaining({
        itemId: watchlist.id,
        symbol: "AAPL",
        status: "unavailable",
        reason: "provider returned stale market data",
      }),
    ]);
    expect(snapshot.portfolioQuotes).toEqual([
      expect.objectContaining({
        lotId: lot.id,
        symbol: "AAPL",
        status: "unavailable",
        reason: "provider returned stale market data",
        includedInTotals: false,
      }),
    ]);
    expect(snapshot.portfolioSummary).toMatchObject({
      totalValue: 0,
      totalCost: 0,
    });
    db.close();
  });

  it("does not let one stale quote mark a concurrently faster quote as stale", async () => {
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
    const lot = service.addPortfolioLot({
      instrument: {
        symbol: "MSFT",
        assetType: "equity",
        name: "Microsoft Corporation",
        exchange: "NMS",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 1,
      avgCost: 350,
      currency: "USD",
    });
    cache.set("test-stale-market-state-api-quote", quote("AAPL", 200), -1);
    vi.mocked(getQuote).mockImplementation(async (symbol: string) => {
      if (symbol === "AAPL") {
        cache.getStale("test-stale-market-state-api-quote", 60_000);
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return quote(symbol, symbol === "AAPL" ? 200 : 400);
    });

    const snapshot = await buildMarketStateQuoteSnapshot(db);

    expect(snapshot.watchlistQuotes).toEqual([
      expect.objectContaining({
        symbol: "AAPL",
        status: "unavailable",
        reason: "provider returned stale market data",
      }),
    ]);
    expect(snapshot.portfolioQuotes).toEqual([
      expect.objectContaining({
        lotId: lot.id,
        symbol: "MSFT",
        status: "ok",
        currentPrice: 400,
        marketValue: 400,
      }),
    ]);
    db.close();
  });

  it("does not compute row P&L when quote and lot currencies differ", async () => {
    const db = initDatabase(":memory:");
    const service = new MarketStateService(db);
    const lot = service.addPortfolioLot({
      instrument: {
        symbol: "SHOP.TO",
        assetType: "equity",
        name: "Shopify Inc.",
        exchange: "TOR",
        currency: "CAD",
        provider: "yahoo",
      },
      quantity: 3,
      avgCost: 100,
      currency: "USD",
    });
    vi.mocked(getQuote).mockResolvedValue(quote("SHOP.TO", 120, { currency: "CAD" }));

    const snapshot = await buildMarketStateQuoteSnapshot(db);

    expect(snapshot.portfolioQuotes).toEqual([
      expect.objectContaining({
        lotId: lot.id,
        symbol: "SHOP.TO",
        status: "unavailable",
        reason: "No FX conversion from CAD to USD",
        includedInTotals: false,
        marketValue: null,
        pnl: null,
        pnlPercent: null,
      }),
    ]);
    expect(snapshot.portfolioSummary).toMatchObject({
      totalValue: 0,
      totalCost: 0,
    });
    db.close();
  });
});

function quote(symbol: string, price: number, overrides: Partial<StockQuote> = {}): StockQuote {
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
    currency: "USD",
    ...overrides,
  };
}
