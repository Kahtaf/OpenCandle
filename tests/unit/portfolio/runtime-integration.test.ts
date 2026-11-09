import { expect, it } from "vitest";
import { buildMarketQuoteSnapshot } from "../../../gui/shared/market-quote-snapshot.js";
import { resolveFx } from "../../../src/portfolio/fx.js";
import {
  buildPortfolioView,
  renderPortfolioView,
} from "../../../src/tools/portfolio/portfolio-view.js";

const now = Date.parse("2026-11-06T20:00:00Z");
const lot = {
  id: 1,
  portfolioId: 1,
  instrumentId: 1,
  symbol: "SAP",
  assetType: "equity",
  quantity: 2,
  avgCost: 8,
  currency: "EUR",
  createdAt: "2026-01-01",
};
const quote = {
  status: "ok" as const,
  price: 10,
  currency: "EUR",
  fetchedAt: new Date(now).toISOString(),
  dataAsOf: new Date(now).toISOString(),
  stale: false,
  change: 1,
  changePercent: 10,
  volume: 1,
  high: 10,
  low: 9,
  week52High: 12,
  week52Low: 5,
  marketCap: 100,
};
const fx = () =>
  resolveFx(
    "EUR",
    "USD",
    {
      provider: "yahoo",
      source: "EUR",
      target: "USD",
      requestedSymbol: "EURUSD=X",
      returnedSymbol: "EURUSD=X",
      rawUnit: "USD",
      rate: 1.25,
      observedAt: now,
      fetchedAt: now,
      cacheStatus: "fresh",
      marketState: "REGULAR",
    },
    now,
  );
it("tracker and GUI expose converted value independently of unavailable historical reporting cost", async () => {
  const tracker = await buildPortfolioView(
    [lot],
    "USD",
    async () => ({ ...quote, asOf: quote.dataAsOf }),
    { now: () => now, resolveFx: fx },
  );
  const gui = await buildMarketQuoteSnapshot(
    { portfolios: [{ id: 1, baseCurrency: "USD" }], portfolio: [lot] },
    { fetchQuote: async () => quote, now: () => new Date(now), resolveFx: fx },
  );
  expect(tracker.totalValue).toBe(25);
  expect(tracker.totalPnl).toBeNull();
  expect(gui.portfolioSummary).toMatchObject({
    status: "complete",
    totalValue: 25,
    totalCost: null,
    totalPnl: null,
  });
  expect(gui.portfolioQuotes[0]).toMatchObject({
    nativeValue: { amount: 20, currency: "EUR" },
    reportingValue: { amount: 25, currency: "USD" },
    nativePnl: { amount: 4, currency: "EUR" },
    pnl: null,
  });
  expect(renderPortfolioView("Portfolio", tracker)).toContain("Value: $25.00 | P&L: unavailable");
});

it("partial valuations never claim a full total or accounting gain", async () => {
  const lots = [lot, { ...lot, id: 2, symbol: "US", currency: "USD" }];
  const result = await buildMarketQuoteSnapshot(
    { portfolios: [{ id: 1 }], portfolio: lots },
    {
      now: () => new Date(now),
      fetchQuote: async (symbol) => ({ ...quote, currency: symbol === "US" ? "USD" : "EUR" }),
      resolveFx: (source, target) => ({
        status: "unavailable",
        source,
        target,
        reason: "missing_fx",
      }),
    },
  );
  expect(result.portfolioSummary).toMatchObject({
    status: "partial",
    totalValue: null,
    valuedSubtotal: 20,
    totalCost: null,
    totalPnl: null,
  });
  expect(result.portfolioQuotes[1]).toMatchObject({
    allocationPercent: null,
    valuedAllocationPercent: 100,
  });
});

it("local and hosted adapters share GBP cross valuation and unavailable contracts", async () => {
  const { buildHostedMarketQuoteSnapshot, buildHostedUnavailableMarketQuoteSnapshot } =
    await import("../../../gui/hosted/runtime/hosted-market-data-api.js");
  const { buildMarketStateQuoteSnapshot } = await import("../../../gui/server/market-state-api.js");
  const { initDatabase } = await import("../../../src/memory/sqlite.js");
  const { MarketStateService } = await import("../../../src/market-state/service.js");
  const { buildMarketStateSnapshot } = await import("../../../gui/server/market-state-api.js");
  const db = initDatabase(":memory:");
  const service = new MarketStateService(db);
  service.addPortfolioLot({
    instrument: { symbol: "SAP", assetType: "equity", currency: "EUR", provider: "yahoo" },
    quantity: 2,
    avgCost: 8,
    currency: "EUR",
  });
  service.setPortfolioBaseCurrency(service.getDefaultPortfolio().name, "GBP");
  const resolve = () =>
    resolveFx(
      "EUR",
      "GBP",
      ["EUR", "GBP"].map((source) => ({
        provider: "yahoo",
        source,
        target: "USD",
        requestedSymbol: `${source}USD=X`,
        returnedSymbol: `${source}USD=X`,
        rawUnit: "USD",
        rate: source === "EUR" ? 1.2 : 1.5,
        observedAt: now,
        fetchedAt: now,
        cacheStatus: "fresh" as const,
        marketState: "REGULAR",
      })),
      now,
    );
  const dependencies = {
    now: () => new Date(now),
    fetchQuote: async () => quote,
    resolveFx: resolve,
  };
  try {
    const state = buildMarketStateSnapshot(db);
    const local = await buildMarketStateQuoteSnapshot(db, dependencies);
    const hosted = await buildHostedMarketQuoteSnapshot(state, dependencies);
    expect(local).toEqual(hosted);
    expect(local.portfolioSummary).toMatchObject({
      status: "complete",

      totalPnl: null,
    });
    expect(local.portfolioSummary.totalValue).toBeCloseTo(16, 10);
    expect(local.portfolioQuotes[0].fx).toMatchObject({ method: "usd_cross" });
    const unavailable = buildHostedUnavailableMarketQuoteSnapshot(state, "relay unavailable");
    expect(unavailable.portfolioSummary).toMatchObject({
      status: "unavailable",
      totalValue: null,
      valuedSubtotal: null,
      totalCost: null,
    });
    expect(unavailable.portfolioQuotes[0]).toMatchObject({
      lotId: state.portfolio[0].id,
      nativeValue: null,
      reportingValue: null,
      reason: "relay unavailable",
    });
  } finally {
    db.close();
  }
});

it("retains rejected security observation times without making them eligible", async () => {
  const result = await buildPortfolioView(
    [lot],
    "USD",
    async () => ({
      status: "unavailable",
      reason: "stale",
      asOf: quote.dataAsOf,
      fetchedAt: quote.fetchedAt,
    }),
    {
      now: () => now,
      resolveFx: () => {
        throw new Error("ineligible security must not fetch FX");
      },
    },
  );
  expect(result.positions[0].securityObservedAt).toBe(now);
  expect(result.totalValue).toBeNull();
});

it("returns an honest empty default snapshot before any saved holdings exist without fetching prices", async () => {
  const { buildUnavailableMarketQuoteSnapshot } = await import(
    "../../../gui/shared/market-quote-snapshot.js"
  );
  const { vi } = await import("vitest");
  const fetchQuote = vi.fn();
  const empty = await buildMarketQuoteSnapshot({}, { fetchQuote, now: () => new Date(now) });
  const offline = buildUnavailableMarketQuoteSnapshot({}, "offline");
  for (const snapshot of [empty, offline]) {
    expect(snapshot.portfolioQuotes).toEqual([]);
    expect(snapshot.watchlistQuotes).toEqual([]);
    expect(snapshot.portfolioSummaries).toEqual([]);
    expect(snapshot.portfolioSummary).toMatchObject({
      portfolioId: 0,
      baseCurrency: "USD",
      status: "empty",
      totalValue: 0,
      valuedSubtotal: 0,
      totalPnl: 0,
      excludedFromTotals: [],
    });
  }
  expect(fetchQuote).not.toHaveBeenCalled();
});
