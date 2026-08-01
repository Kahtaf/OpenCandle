import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedMarketQuoteSnapshot,
  buildHostedUnavailableMarketQuoteSnapshot,
  getHostedInstrumentQuoteSnapshot,
} from "../../../gui/hosted/runtime/hosted-market-data-api.js";
import { getHistory, getQuote } from "../../../src/providers/yahoo-finance.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getHistory: vi.fn(),
  getQuote: vi.fn(),
  getYahooCompanyOverview: vi.fn(),
}));

describe("hosted market data API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getHistory).mockResolvedValue([
      {
        date: "2026-07-31",
        timestamp: 1_754_000_000,
        open: 198,
        high: 202,
        low: 197,
        close: 200,
        volume: 1_000,
      },
      {
        date: "2026-07-31",
        timestamp: 1_754_000_300,
        open: 200,
        high: 204,
        low: 199,
        close: 203,
        volume: 1_200,
      },
    ]);
    vi.mocked(getQuote).mockResolvedValue({
      symbol: "AAPL",
      name: "Apple Inc.",
      price: 203,
      change: 3,
      changePercent: 1.5,
      open: 198,
      high: 204,
      low: 197,
      previousClose: 200,
      volume: 2_000,
      marketCap: 3_000_000,
      pe: null,
      week52High: 220,
      week52Low: 160,
      timestamp: "2026-07-31T20:00:00.000Z",
      asOf: "2026-07-31T20:00:00.000Z",
      currency: "USD",
    });
  });

  it("returns the same quote fields the symbol page expects", async () => {
    await expect(getHostedInstrumentQuoteSnapshot("aapl")).resolves.toMatchObject({
      symbol: "AAPL",
      status: "ok",
      name: "Apple Inc.",
      price: 203,
      changePercent: 1.5,
      currency: "USD",
    });
  });

  it("builds watchlist and portfolio quote rows from browser-owned state", async () => {
    const snapshot = await buildHostedMarketQuoteSnapshot({
      watchlists: [{ id: 1, name: "Default", isDefault: true }],
      portfolios: [{ id: 2, name: "Default", isDefault: true, baseCurrency: "USD" }],
      watchlist: [{ id: 3, instrumentId: 4, symbol: "AAPL" }],
      portfolio: [
        {
          id: 5,
          portfolioId: 2,
          instrumentId: 4,
          symbol: "AAPL",
          quantity: 2,
          avgCost: 180,
          currency: "USD",
          instrumentCurrency: "USD",
        },
      ],
    });

    expect(snapshot.watchlistQuotes[0]).toMatchObject({
      itemId: 3,
      symbol: "AAPL",
      status: "ok",
      price: 203,
      dayHigh: 204,
      dayLow: 197,
      sparkline: { status: "ok", points: [200, 203] },
    });
    expect(snapshot.portfolioQuotes[0]).toMatchObject({
      lotId: 5,
      symbol: "AAPL",
      currentPrice: 203,
      marketValue: 406,
      totalCost: 360,
      pnl: 46,
      allocationPercent: 100,
    });
    expect(snapshot.portfolioSummary).toMatchObject({
      portfolioId: 2,
      totalValue: 406,
      totalCost: 360,
      totalPnl: 46,
    });
  });

  it("does not calculate portfolio valuation or P&L across mismatched currencies", async () => {
    vi.mocked(getQuote).mockResolvedValueOnce({
      symbol: "SHOP.TO",
      name: "Shopify Inc.",
      price: 150,
      change: 2,
      changePercent: 1.35,
      open: 148,
      high: 151,
      low: 147,
      previousClose: 148,
      volume: 2_000,
      marketCap: 200_000_000,
      pe: null,
      week52High: 170,
      week52Low: 90,
      timestamp: "2026-07-31T20:00:00.000Z",
      asOf: "2026-07-31T20:00:00.000Z",
      currency: "CAD",
    });

    const snapshot = await buildHostedMarketQuoteSnapshot({
      portfolios: [{ id: 2, name: "Default", isDefault: true, baseCurrency: "USD" }],
      portfolio: [
        {
          id: 5,
          portfolioId: 2,
          instrumentId: 4,
          symbol: "SHOP.TO",
          quantity: 2,
          avgCost: 100,
          currency: "USD",
          instrumentCurrency: "CAD",
        },
      ],
    });

    expect(snapshot.portfolioQuotes[0]).toMatchObject({
      status: "unavailable",
      currentPrice: null,
      marketValue: null,
      totalCost: 200,
      pnl: null,
      pnlPercent: null,
      includedInTotals: false,
      reason: "No FX conversion from CAD to USD",
    });
  });

  it("preserves saved watchlist and portfolio rows when the relay is unavailable", () => {
    const snapshot = buildHostedUnavailableMarketQuoteSnapshot(
      {
        portfolios: [{ id: 2, name: "Default", isDefault: true, baseCurrency: "CAD" }],
        watchlist: [{ id: 3, instrumentId: 4, symbol: "AAPL" }],
        portfolio: [
          {
            id: 5,
            portfolioId: 2,
            instrumentId: 4,
            symbol: "AAPL",
            quantity: 2,
            avgCost: 180,
            currency: "CAD",
          },
        ],
      },
      "Audited provider relay is unavailable",
    );

    expect(snapshot.watchlistQuotes).toEqual([
      expect.objectContaining({ itemId: 3, symbol: "AAPL", status: "unavailable" }),
    ]);
    expect(snapshot.portfolioQuotes).toEqual([
      expect.objectContaining({
        lotId: 5,
        portfolioId: 2,
        symbol: "AAPL",
        status: "unavailable",
        totalCost: 360,
        currency: "CAD",
        includedInTotals: false,
      }),
    ]);
    expect(snapshot.portfolioSummary).toMatchObject({
      portfolioId: 2,
      baseCurrency: "CAD",
      status: "unavailable",
      totalValue: null,
      totalCost: 360,
      totalPnl: null,
      totalPnlPercent: null,
      excludedFromTotals: [
        { symbol: "AAPL", currency: "CAD", reason: "Audited provider relay is unavailable" },
      ],
    });
  });
});
