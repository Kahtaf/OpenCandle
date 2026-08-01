import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMarketStateQuoteSnapshot,
  buildMarketStateSnapshot,
  createSavedSymbolsMemo,
  getInstrumentOverviewSnapshot,
  getInstrumentQuoteSnapshot,
  resetInstrumentOverviewMemoForTests,
  searchInstrumentCandidates,
} from "../../../gui/server/market-state-api.js";
import { cache } from "../../../src/infra/cache.js";
import { searchYahooInstruments } from "../../../src/market-state/resolve.js";
import { MarketStateService } from "../../../src/market-state/service.js";
import { initDatabase } from "../../../src/memory/sqlite.js";
import { getQuote, getYahooCompanyOverview } from "../../../src/providers/yahoo-finance.js";
import type { CompanyOverview } from "../../../src/types/fundamentals.js";
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
  getYahooCompanyOverview: vi.fn(),
}));

describe("market-state API helpers", () => {
  beforeEach(() => {
    cache.clear();
    resetInstrumentOverviewMemoForTests();
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

  it("returns a one-symbol quote snapshot for holding autofill", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T20:20:00.000Z"));
    vi.mocked(getQuote).mockResolvedValue(
      quote("ASTS", 42.37, {
        marketCap: 9_876_543_210,
        currency: "USD",
        asOf: "2026-06-12T20:00:00.000Z",
        marketState: "POST",
        extendedPrice: 42.8,
        extendedChange: 0.43,
        extendedChangePercent: 1.02,
        extendedAsOf: "2026-06-12T20:14:00.000Z",
      }),
    );

    await expect(getInstrumentQuoteSnapshot(" asts ")).resolves.toEqual({
      symbol: "ASTS",
      status: "ok",
      name: "ASTS Holdings",
      price: 42.37,
      change: 1,
      changePercent: 0.5,
      volume: 1_000,
      high: 43.37,
      low: 40.37,
      week52High: 52.37,
      week52Low: 32.37,
      marketCap: 9_876_543_210,
      fetchedAt: "2026-06-12T20:20:00.000Z",
      dataAsOf: "2026-06-12T20:00:00.000Z",
      marketState: "POST",
      extendedPrice: 42.8,
      extendedChange: 0.43,
      extendedChangePercent: 1.02,
      extendedAsOf: "2026-06-12T20:14:00.000Z",
      stale: false,
      currency: "USD",
    });
  });

  it("returns a normalized Yahoo company overview snapshot", async () => {
    vi.mocked(getYahooCompanyOverview).mockResolvedValue(companyOverview("AAPL"));

    await expect(getInstrumentOverviewSnapshot(" aapl ")).resolves.toEqual({
      symbol: "AAPL",
      status: "ok",
      name: "Apple Inc.",
      description: "Consumer technology company.",
      exchange: "NasdaqGS",
      sector: "Technology",
      industry: "Consumer Electronics",
      marketCap: 3_200_000_000_000,
      pe: 31.5,
      forwardPe: 28.4,
      eps: 7.1,
      dividendYield: 0.0044,
      beta: 1.2,
      avgVolume: 55_000_000,
      profitMargin: 0.24,
      revenueGrowth: 0.05,
      week52High: 260.1,
      week52Low: 164.08,
      stale: false,
    });
    expect(getYahooCompanyOverview).toHaveBeenCalledWith("AAPL");
  });

  it("returns unavailable overview snapshots for empty and unknown symbols", async () => {
    vi.mocked(getYahooCompanyOverview).mockRejectedValue(new Error("no company overview"));

    await expect(getInstrumentOverviewSnapshot("   ")).resolves.toEqual({
      symbol: "",
      status: "unavailable",
      reason: "symbol is required",
    });
    await expect(getInstrumentOverviewSnapshot("unknown")).resolves.toEqual({
      symbol: "UNKNOWN",
      status: "unavailable",
      reason: "no company overview",
    });
    expect(getYahooCompanyOverview).toHaveBeenCalledOnce();
  });

  it("coalesces concurrent overview requests for one symbol", async () => {
    resetInstrumentOverviewMemoForTests();
    let resolveOverview: ((value: CompanyOverview) => void) | undefined;
    vi.mocked(getYahooCompanyOverview).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveOverview = resolve;
        }),
    );

    const first = getInstrumentOverviewSnapshot("AAPL");
    const second = getInstrumentOverviewSnapshot("aapl");

    expect(getYahooCompanyOverview).toHaveBeenCalledOnce();
    resolveOverview?.(companyOverview("AAPL"));
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ symbol: "AAPL", status: "ok" }),
      expect.objectContaining({ symbol: "AAPL", status: "ok" }),
    ]);
  });

  it("serves overview memo hits within the TTL and stale data while revalidating", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T14:00:00.000Z"));
    vi.mocked(getYahooCompanyOverview).mockResolvedValueOnce(companyOverview("AAPL"));

    const initial = await getInstrumentOverviewSnapshot("AAPL");
    await expect(getInstrumentOverviewSnapshot("AAPL")).resolves.toBe(initial);
    expect(getYahooCompanyOverview).toHaveBeenCalledOnce();

    vi.setSystemTime(new Date("2026-07-16T14:05:00.001Z"));
    let resolveRefresh: ((value: CompanyOverview) => void) | undefined;
    vi.mocked(getYahooCompanyOverview).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        }),
    );

    await expect(getInstrumentOverviewSnapshot("AAPL")).resolves.toMatchObject({
      symbol: "AAPL",
      status: "ok",
      stale: true,
    });
    expect(getYahooCompanyOverview).toHaveBeenCalledTimes(2);

    resolveRefresh?.(companyOverview("AAPL", { name: "Apple refreshed" }));
    await vi.advanceTimersByTimeAsync(0);
    await expect(getInstrumentOverviewSnapshot("AAPL")).resolves.toMatchObject({
      name: "Apple refreshed",
    });
    expect(getYahooCompanyOverview).toHaveBeenCalledTimes(2);
  });

  it("keeps expired overview data stale when the background refresh degrades", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T14:00:00.000Z"));
    vi.mocked(getYahooCompanyOverview).mockResolvedValueOnce(companyOverview("AAPL"));
    await getInstrumentOverviewSnapshot("AAPL");

    vi.setSystemTime(new Date("2026-07-16T14:05:00.001Z"));
    vi.mocked(getYahooCompanyOverview).mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(getInstrumentOverviewSnapshot("AAPL")).resolves.toMatchObject({
      symbol: "AAPL",
      status: "ok",
      name: "Apple Inc.",
      stale: true,
    });
    await vi.advanceTimersByTimeAsync(0);
    await expect(getInstrumentOverviewSnapshot("AAPL")).resolves.toMatchObject({
      symbol: "AAPL",
      status: "ok",
      name: "Apple Inc.",
      stale: true,
    });
  });

  it("keeps overview memo entries independent by symbol", async () => {
    vi.mocked(getYahooCompanyOverview).mockImplementation(async (symbol) =>
      companyOverview(symbol, { name: `${symbol} Company` }),
    );

    await expect(
      Promise.all([
        getInstrumentOverviewSnapshot("AAPL"),
        getInstrumentOverviewSnapshot("MSFT"),
        getInstrumentOverviewSnapshot("AAPL"),
      ]),
    ).resolves.toEqual([
      expect.objectContaining({ symbol: "AAPL", name: "AAPL Company" }),
      expect.objectContaining({ symbol: "MSFT", name: "MSFT Company" }),
      expect.objectContaining({ symbol: "AAPL", name: "AAPL Company" }),
    ]);
    expect(getYahooCompanyOverview).toHaveBeenCalledTimes(2);
    expect(getYahooCompanyOverview).toHaveBeenCalledWith("AAPL");
    expect(getYahooCompanyOverview).toHaveBeenCalledWith("MSFT");
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
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T20:20:00.000Z"));
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
      quote(symbol, symbol === "AAPL" ? 190 : symbol === "MSFT" ? 400 : 300, {
        asOf: "2026-06-12T20:00:00.000Z",
        marketState: "POST",
        extendedPrice: 83.02,
        extendedChange: -0.53,
        extendedChangePercent: -0.64,
        extendedAsOf: "2026-06-12T20:14:00.000Z",
      }),
    );

    const snapshot = await buildMarketStateQuoteSnapshot(db);

    expect(snapshot.watchlistQuotes).toEqual([
      expect.objectContaining({
        itemId: watchlist.id,
        symbol: "AAPL",
        status: "ok",
        name: "AAPL Holdings",
        price: 190,
        change: 1,
        volume: 1_000,
        dayHigh: 191,
        dayLow: 188,
        week52High: 200,
        week52Low: 180,
        fetchedAt: "2026-06-12T20:20:00.000Z",
        dataAsOf: "2026-06-12T20:00:00.000Z",
        marketState: "POST",
        extendedPrice: 83.02,
        extendedChange: -0.53,
        extendedChangePercent: -0.64,
        extendedAsOf: "2026-06-12T20:14:00.000Z",
      }),
    ]);
    expect(snapshot.portfolioQuotes).toEqual([
      expect.objectContaining({
        lotId: lot.id,
        symbol: "VTI",
        status: "ok",
        name: "VTI Holdings",
        currentPrice: 300,
        marketValue: 600,
        pnl: 100,
        allocationPercent: 60,
        dataAsOf: "2026-06-12T20:00:00.000Z",
        marketState: "POST",
        extendedPrice: 83.02,
      }),
      expect.objectContaining({
        lotId: secondLot.id,
        symbol: "MSFT",
        status: "ok",
        name: "MSFT Holdings",
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

  it("carries asset types without fetching compact sparkline history", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T20:20:00.000Z"));
    const db = initDatabase(":memory:");
    const service = new MarketStateService(db);
    service.addWatchlistItem({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        currency: "USD",
        provider: "yahoo",
      },
    });
    service.addPortfolioLot({
      instrument: {
        symbol: "AAPL",
        assetType: "equity",
        currency: "USD",
        provider: "yahoo",
      },
      quantity: 2,
      avgCost: 150,
      currency: "USD",
    });
    vi.mocked(getQuote).mockResolvedValue(quote("AAPL", 190));
    const snapshot = await buildMarketStateQuoteSnapshot(db);

    expect(snapshot.watchlistQuotes[0]).toMatchObject({ symbol: "AAPL", assetType: "equity" });
    expect(snapshot.portfolioQuotes[0]).toMatchObject({ symbol: "AAPL", assetType: "equity" });
    expect(snapshot.watchlistQuotes[0]).not.toHaveProperty("sparkline");
    expect(snapshot.portfolioQuotes[0]).not.toHaveProperty("sparkline");
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
      status: "unavailable",
      totalValue: null,
      totalCost: 300,
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
      status: "unavailable",
      totalValue: null,
      totalCost: 300,
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
      status: "unavailable",
      totalValue: null,
      totalCost: 300,
    });
    db.close();
  });
});

function quote(symbol: string, price: number, overrides: Partial<StockQuote> = {}): StockQuote {
  return {
    symbol,
    name: `${symbol} Holdings`,
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

function companyOverview(
  symbol: string,
  overrides: Partial<CompanyOverview> = {},
): CompanyOverview {
  return {
    symbol,
    name: "Apple Inc.",
    description: "Consumer technology company.",
    exchange: "NasdaqGS",
    sector: "Technology",
    industry: "Consumer Electronics",
    marketCap: 3_200_000_000_000,
    pe: 31.5,
    forwardPe: 28.4,
    eps: 7.1,
    dividendYield: 0.0044,
    beta: 1.2,
    week52High: 260.1,
    week52Low: 164.08,
    avgVolume: 55_000_000,
    profitMargin: 0.24,
    revenueGrowth: 0.05,
    ...overrides,
  };
}
