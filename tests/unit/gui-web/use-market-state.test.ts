import { describe, expect, it } from "vitest";
import { mergeMarketStateSnapshot } from "../../../gui/web/src/hooks/useMarketState.jsx";

describe("mergeMarketStateSnapshot", () => {
  it("preserves refreshed quote snapshots across regular state polls", () => {
    const current = {
      watchlist: [],
      portfolio: [],
      predictions: [],
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
      predictions: [],
      alerts: [],
      alertEvents: [],
      reportTemplates: [],
      reportRuns: [],
    });

    expect(next.quoteSnapshot).toBe(current.quoteSnapshot);
    expect(next.watchlist).toEqual([{ id: 1, symbol: "AAPL" }]);
  });

  it("replaces quote snapshots when the response includes one", () => {
    const next = mergeMarketStateSnapshot({
      quoteSnapshot: { watchlistQuotes: [{ itemId: 1, symbol: "AAPL", price: 190 }] },
    }, {
      quoteSnapshot: { watchlistQuotes: [{ itemId: 1, symbol: "AAPL", price: 191 }] },
    });

    expect(next.quoteSnapshot).toEqual({
      watchlistQuotes: [{ itemId: 1, symbol: "AAPL", price: 191 }],
    });
  });
});
