import { describe, expect, it } from "vitest";
import { mergeMarketStateSnapshot } from "../../../gui/web/src/hooks/useMarketState.jsx";

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
        quoteSnapshot: { watchlistQuotes: [{ itemId: 1, symbol: "AAPL", price: 191 }] },
      },
    );

    expect(next.quoteSnapshot).toEqual({
      watchlistQuotes: [{ itemId: 1, symbol: "AAPL", price: 191 }],
    });
  });

  it("invalidates portfolio quote-derived values when saved lot fields change", () => {
    const current = {
      watchlist: [],
      portfolio: [
        { id: 2, instrumentId: 20, symbol: "VTI", quantity: 2, avgCost: 250, currency: "USD" },
      ],
      quoteSnapshot: {
        watchlistQuotes: [{ itemId: 1, symbol: "AAPL", price: 190 }],
        portfolioQuotes: [{ lotId: 2, symbol: "VTI", marketValue: 600, pnl: 100 }],
        portfolioSummary: { totalValue: 600, totalPnl: 100, baseCurrency: "USD" },
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
  });
});
