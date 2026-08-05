import { describe, expect, it } from "vitest";
import {
  createLatestRequestGate,
  EMPTY_MARKET_STATE,
  MARKET_STATE_POLL_MS,
  mergeMarketStateSnapshot,
  mergeQuoteRefreshSnapshot,
  QUOTE_REFRESH_INTERVAL_MS,
} from "../../../gui/web/src/hooks/useMarketState.jsx";

describe("market-state refresh intervals", () => {
  it("refreshes quotes immediately on render and every five minutes after that", () => {
    expect(MARKET_STATE_POLL_MS).toBe(4000);
    expect(QUOTE_REFRESH_INTERVAL_MS).toBe(5 * 60 * 1000);
  });
});

describe("createLatestRequestGate", () => {
  it("invalidates an older quote refresh as soon as a newer one starts", () => {
    const gate = createLatestRequestGate();
    const first = gate.start();
    const second = gate.start();

    expect(first.isLatest()).toBe(false);
    expect(second.isLatest()).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });
});

describe("mergeMarketStateSnapshot", () => {
  it("preserves refreshed quote snapshots across regular state polls", () => {
    const current = {
      watchlist: [],
      portfolio: [],
      alerts: [],
      alertEvents: [],
      reportTemplates: [],
      reportRuns: [],
      quoteSnapshot: {
        watchlistQuotes: [{ itemId: 1, symbol: "AAPL", price: 190 }],
        portfolioQuotes: [{ lotId: 2, symbol: "VTI", price: 300 }],
      },
    };

    const next = mergeMarketStateSnapshot(current, {
      watchlist: [{ id: 1, symbol: "AAPL" }],
      portfolio: [],
      alerts: [],
      alertEvents: [],
      reportTemplates: [],
      reportRuns: [],
    });

    expect(next.quoteSnapshot).toBe(current.quoteSnapshot);
    expect(next.watchlist).toEqual([{ id: 1, symbol: "AAPL" }]);
  });

  it("replaces quote snapshots when the response includes one", () => {
    const next = mergeMarketStateSnapshot(
      {
        quoteSnapshot: { watchlistQuotes: [{ itemId: 1, symbol: "AAPL", price: 190 }] },
      },
      {
        quoteSnapshot: {
          watchlistQuotes: [
            {
              itemId: 1,
              symbol: "AAPL",
              price: 191,
              fetchedAt: "2026-06-12T20:20:00.000Z",
              dataAsOf: "2026-06-12T20:00:00.000Z",
              marketState: "POST",
              extendedPrice: 191.5,
              extendedChange: 0.5,
              extendedChangePercent: 0.26,
              extendedAsOf: "2026-06-12T20:14:00.000Z",
            },
          ],
        },
      },
    );

    expect(next.quoteSnapshot).toEqual({
      watchlistQuotes: [
        {
          itemId: 1,
          symbol: "AAPL",
          price: 191,
          fetchedAt: "2026-06-12T20:20:00.000Z",
          dataAsOf: "2026-06-12T20:00:00.000Z",
          marketState: "POST",
          extendedPrice: 191.5,
          extendedChange: 0.5,
          extendedChangePercent: 0.26,
          extendedAsOf: "2026-06-12T20:14:00.000Z",
        },
      ],
    });
  });

  it("invalidates portfolio quote-derived values when saved lot fields change", () => {
    const current = {
      loaded: true,
      watchlist: [],
      portfolio: [
        { id: 2, instrumentId: 20, symbol: "VTI", quantity: 2, avgCost: 250, currency: "USD" },
      ],
      quoteSnapshot: {
        watchlistQuotes: [{ itemId: 1, symbol: "AAPL", price: 190 }],
        portfolioQuotes: [{ lotId: 2, symbol: "VTI", marketValue: 600, pnl: 100 }],
        portfolioSummary: { totalValue: 600, totalPnl: 100, baseCurrency: "USD" },
        portfolioSummaries: [
          { portfolioId: 1, totalValue: 600, totalPnl: 100, baseCurrency: "USD" },
        ],
      },
    };

    const next = mergeMarketStateSnapshot(current, {
      portfolio: [
        { id: 2, instrumentId: 20, symbol: "VTI", quantity: 4, avgCost: 250, currency: "USD" },
      ],
    });

    expect(next.quoteSnapshot.watchlistQuotes).toBe(current.quoteSnapshot.watchlistQuotes);
    expect(next.quoteSnapshot.portfolioQuotes).toEqual([]);
    expect(next.quoteSnapshot.portfolioSummary).toBeNull();
    expect(next.quoteSnapshot.portfolioSummaries).toEqual([]);
  });

  it("keeps portfolio quotes that arrived before the first market-state response", () => {
    // On mount both polls start together. A warm server-side snapshot lets the
    // quote response win the race, so the quote snapshot lands while the saved
    // portfolio list is still the empty default. That is "not loaded yet", not
    // "the portfolio changed", so the quote rows must survive.
    const quoteSnapshot = {
      watchlistQuotes: [{ itemId: 1, symbol: "ASTS", price: 70.31 }],
      portfolioQuotes: [
        {
          lotId: 2,
          portfolioId: 1,
          instrumentId: 20,
          symbol: "ASTS",
          status: "ok",
          currentPrice: 70.31,
          marketValue: 703.1,
          totalCost: 500,
          currency: "USD",
          includedInTotals: true,
        },
      ],
      portfolioSummary: { portfolioId: 1, totalValue: 703.1, baseCurrency: "USD", status: "ok" },
      portfolioSummaries: [
        { portfolioId: 1, totalValue: 703.1, baseCurrency: "USD", status: "ok" },
      ],
    };
    const current = { ...EMPTY_MARKET_STATE, quoteSnapshot };

    const next = mergeMarketStateSnapshot(current, {
      watchlist: [{ id: 1, instrumentId: 20, symbol: "ASTS", assetType: "stock" }],
      portfolio: [
        {
          id: 2,
          portfolioId: 1,
          instrumentId: 20,
          symbol: "ASTS",
          quantity: 10,
          avgCost: 50,
          currency: "USD",
        },
      ],
      portfolios: [{ id: 1, isDefault: true, baseCurrency: "USD" }],
    });

    expect(next.quoteSnapshot.portfolioQuotes).toEqual(quoteSnapshot.portfolioQuotes);
    expect(next.quoteSnapshot.portfolioSummary).toEqual(quoteSnapshot.portfolioSummary);
    expect(next.quoteSnapshot.portfolioSummaries).toEqual(quoteSnapshot.portfolioSummaries);
  });

  it("still invalidates portfolio quotes for an edit made after the portfolio list loaded", () => {
    const loaded = mergeMarketStateSnapshot(
      { ...EMPTY_MARKET_STATE },
      {
        portfolio: [
          { id: 2, instrumentId: 20, symbol: "VTI", quantity: 2, avgCost: 250, currency: "USD" },
        ],
      },
    );
    const withQuotes = {
      ...loaded,
      quoteSnapshot: {
        watchlistQuotes: [],
        portfolioQuotes: [{ lotId: 2, symbol: "VTI", marketValue: 600, pnl: 100 }],
        portfolioSummary: { portfolioId: 1, totalValue: 600, baseCurrency: "USD" },
        portfolioSummaries: [{ portfolioId: 1, totalValue: 600, baseCurrency: "USD" }],
      },
    };

    const next = mergeMarketStateSnapshot(withQuotes, {
      portfolio: [
        { id: 2, instrumentId: 20, symbol: "VTI", quantity: 4, avgCost: 250, currency: "USD" },
      ],
    });

    expect(next.quoteSnapshot.portfolioQuotes).toEqual([]);
    expect(next.quoteSnapshot.portfolioSummary).toBeNull();
    expect(next.quoteSnapshot.portfolioSummaries).toEqual([]);
  });
});

describe("mergeQuoteRefreshSnapshot", () => {
  it("keeps last valid hosted values when a transient refresh is unavailable", () => {
    const current = {
      generatedAt: "2026-08-01T12:00:00.000Z",
      watchlistQuotes: [
        {
          itemId: 1,
          symbol: "AAPL",
          status: "ok",
          price: 190,
          changePercent: 1.2,
          fetchedAt: "2026-08-01T11:59:00.000Z",
        },
      ],
      portfolioQuotes: [
        {
          lotId: 2,
          portfolioId: 3,
          symbol: "VTI",
          status: "ok",
          marketValue: 600,
          totalCost: 500,
          pnl: 100,
          includedInTotals: true,
          fetchedAt: "2026-08-01T11:59:00.000Z",
        },
      ],
      portfolioSummary: {
        portfolioId: 3,
        status: "ok",
        totalValue: 600,
        totalPnl: 100,
        baseCurrency: "USD",
      },
      portfolioSummaries: [
        {
          portfolioId: 3,
          status: "ok",
          totalValue: 600,
          totalPnl: 100,
          baseCurrency: "USD",
        },
      ],
    };
    const refreshed = {
      generatedAt: "2026-08-01T12:05:00.000Z",
      watchlistQuotes: [
        { itemId: 1, symbol: "AAPL", status: "unavailable", reason: "relay timeout" },
      ],
      portfolioQuotes: [
        {
          lotId: 2,
          portfolioId: 3,
          symbol: "VTI",
          status: "unavailable",
          reason: "relay timeout",
        },
      ],
      portfolioSummary: {
        portfolioId: 3,
        status: "unavailable",
        totalValue: null,
        totalPnl: null,
        baseCurrency: "USD",
      },
      portfolioSummaries: [
        {
          portfolioId: 3,
          status: "unavailable",
          totalValue: null,
          totalPnl: null,
          baseCurrency: "USD",
        },
      ],
    };

    const merged = mergeQuoteRefreshSnapshot(current, refreshed);

    expect(merged.watchlistQuotes[0]).toMatchObject({
      status: "ok",
      price: 190,
      stale: true,
      refreshStatus: "unavailable",
      refreshReason: "relay timeout",
      refreshFailedAt: "2026-08-01T12:05:00.000Z",
    });
    expect(merged.portfolioQuotes[0]).toMatchObject({
      status: "ok",
      marketValue: 600,
      stale: true,
      refreshStatus: "unavailable",
    });
    expect(merged.portfolioSummary).toMatchObject({
      totalValue: 600,
      totalPnl: 100,
      stale: true,
      refreshStatus: "unavailable",
    });
    expect(merged.generatedAt).toBe("2026-08-01T12:05:00.000Z");
    expect(merged.lastSuccessfulGeneratedAt).toBe("2026-08-01T12:00:00.000Z");
  });

  it("recomputes portfolio totals from fresh and retained quote rows", () => {
    const current = {
      generatedAt: "2026-08-01T12:00:00.000Z",
      watchlistQuotes: [],
      portfolioQuotes: [
        {
          lotId: 1,
          portfolioId: 3,
          status: "ok",
          marketValue: 600,
          totalCost: 500,
          pnl: 100,
          includedInTotals: true,
        },
        {
          lotId: 2,
          portfolioId: 3,
          status: "ok",
          marketValue: 200,
          totalCost: 150,
          pnl: 50,
          includedInTotals: true,
        },
      ],
      portfolioSummary: {
        portfolioId: 3,
        status: "ok",
        totalValue: 800,
        totalCost: 650,
        totalPnl: 150,
        totalPnlPercent: 23.08,
        baseCurrency: "USD",
      },
      portfolioSummaries: [],
    };
    current.portfolioSummaries = [current.portfolioSummary];
    const refreshed = {
      generatedAt: "2026-08-01T12:05:00.000Z",
      watchlistQuotes: [],
      portfolioQuotes: [
        {
          lotId: 1,
          portfolioId: 3,
          status: "ok",
          marketValue: 650,
          totalCost: 500,
          pnl: 150,
          includedInTotals: true,
        },
        {
          lotId: 2,
          portfolioId: 3,
          status: "unavailable",
          reason: "relay timeout",
        },
      ],
      portfolioSummary: {
        portfolioId: 3,
        status: "unavailable",
        totalValue: null,
        totalCost: 650,
        totalPnl: null,
        totalPnlPercent: null,
        baseCurrency: "USD",
      },
      portfolioSummaries: [],
    };
    refreshed.portfolioSummaries = [refreshed.portfolioSummary];

    const merged = mergeQuoteRefreshSnapshot(current, refreshed);

    expect(merged.portfolioSummary).toMatchObject({
      totalValue: 850,
      totalCost: 650,
      totalPnl: 200,
      stale: true,
      refreshStatus: "unavailable",
    });
    expect(merged.portfolioSummary.totalPnlPercent).toBeCloseTo(30.77, 2);
    expect(merged.portfolioSummaries[0]).toMatchObject(merged.portfolioSummary);
  });

  it("recomputes base-currency totals while preserving excluded-currency rows", () => {
    const current = {
      generatedAt: "2026-08-01T12:00:00.000Z",
      watchlistQuotes: [],
      portfolioQuotes: [
        {
          lotId: 1,
          portfolioId: 3,
          status: "ok",
          marketValue: 600,
          totalCost: 500,
          pnl: 100,
          includedInTotals: true,
        },
        {
          lotId: 2,
          portfolioId: 3,
          status: "ok",
          marketValue: null,
          totalCost: 200,
          pnl: null,
          includedInTotals: false,
          currency: "CAD",
        },
      ],
      portfolioSummary: {
        portfolioId: 3,
        status: "ok",
        totalValue: 600,
        totalCost: 500,
        totalPnl: 100,
        totalPnlPercent: 20,
        baseCurrency: "USD",
        excludedFromTotals: [{ symbol: "SHOP.TO", currency: "CAD" }],
      },
      portfolioSummaries: [],
    };
    current.portfolioSummaries = [current.portfolioSummary];
    const refreshed = {
      generatedAt: "2026-08-01T12:05:00.000Z",
      watchlistQuotes: [],
      portfolioQuotes: [
        { lotId: 1, portfolioId: 3, status: "unavailable", reason: "relay timeout" },
        current.portfolioQuotes[1],
      ],
      portfolioSummary: {
        ...current.portfolioSummary,
        status: "unavailable",
        totalValue: null,
        totalPnl: null,
      },
      portfolioSummaries: [],
    };
    refreshed.portfolioSummaries = [refreshed.portfolioSummary];

    const merged = mergeQuoteRefreshSnapshot(current, refreshed);

    expect(merged.portfolioSummary).toMatchObject({
      status: "ok",
      totalValue: 600,
      totalCost: 500,
      totalPnl: 100,
      excludedFromTotals: [{ symbol: "SHOP.TO", currency: "CAD" }],
      stale: true,
    });
  });

  it("does not publish a partial total when an unavailable base-currency row has no prior quote", () => {
    const current = {
      generatedAt: "2026-08-01T12:00:00.000Z",
      watchlistQuotes: [],
      portfolioQuotes: [
        {
          lotId: 1,
          portfolioId: 3,
          status: "ok",
          marketValue: 600,
          totalCost: 500,
          pnl: 100,
          includedInTotals: true,
          currency: "USD",
        },
      ],
      portfolioSummary: {
        portfolioId: 3,
        status: "ok",
        totalValue: 600,
        totalCost: 500,
        totalPnl: 100,
        totalPnlPercent: 20,
        baseCurrency: "USD",
      },
      portfolioSummaries: [],
    };
    current.portfolioSummaries = [current.portfolioSummary];
    const refreshed = {
      generatedAt: "2026-08-01T12:05:00.000Z",
      watchlistQuotes: [],
      portfolioQuotes: [
        current.portfolioQuotes[0],
        {
          lotId: 2,
          portfolioId: 3,
          status: "unavailable",
          reason: "relay timeout",
          includedInTotals: false,
          currency: "USD",
        },
      ],
      portfolioSummary: {
        portfolioId: 3,
        status: "unavailable",
        totalValue: null,
        totalCost: 700,
        totalPnl: null,
        totalPnlPercent: null,
        baseCurrency: "USD",
      },
      portfolioSummaries: [],
    };
    refreshed.portfolioSummaries = [refreshed.portfolioSummary];

    const merged = mergeQuoteRefreshSnapshot(current, refreshed);

    expect(merged.portfolioSummary).toMatchObject({
      status: "unavailable",
      totalValue: null,
      totalPnl: null,
      stale: true,
      refreshStatus: "unavailable",
    });
  });

  it("does not retain a previous portfolio quote after a structural currency failure", () => {
    const current = {
      generatedAt: "2026-08-01T12:00:00.000Z",
      watchlistQuotes: [],
      portfolioQuotes: [
        { lotId: 1, portfolioId: 3, status: "ok", marketValue: 600, includedInTotals: true },
      ],
      portfolioSummary: { portfolioId: 3, status: "ok", totalValue: 600, baseCurrency: "USD" },
      portfolioSummaries: [],
    };
    const refreshed = {
      generatedAt: "2026-08-01T12:05:00.000Z",
      watchlistQuotes: [],
      portfolioQuotes: [
        {
          lotId: 1,
          portfolioId: 3,
          status: "unavailable",
          reason: "No FX conversion from CAD to USD",
          currency: "CAD",
          includedInTotals: false,
        },
      ],
      portfolioSummary: {
        portfolioId: 3,
        status: "unavailable",
        totalValue: null,
        baseCurrency: "USD",
      },
      portfolioSummaries: [],
    };

    const merged = mergeQuoteRefreshSnapshot(current, refreshed);
    expect(merged.portfolioQuotes[0]).toMatchObject({ status: "unavailable", currency: "CAD" });
    expect(merged.portfolioQuotes[0]).not.toHaveProperty("marketValue");
  });
});
