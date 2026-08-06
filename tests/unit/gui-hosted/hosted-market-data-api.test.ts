import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildHostedMarketQuoteSnapshot,
  buildHostedUnavailableMarketQuoteSnapshot,
  getHostedInstrumentHistorySnapshot,
  getHostedInstrumentQuoteSnapshot,
} from "../../../gui/hosted/runtime/hosted-market-data-api.js";
import { cache } from "../../../src/infra/cache.js";
import { getHistory, getQuote } from "../../../src/providers/yahoo-finance.js";

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getHistory: vi.fn(),
  getQuote: vi.fn(),
  getYahooCompanyOverview: vi.fn(),
}));

describe("hosted market data API", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-31T20:05:00.000Z"));
    cache.clear();
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

  afterEach(() => {
    vi.useRealTimers();
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

  it("rejects a zero current price even when Yahoo returns other populated fields", async () => {
    vi.mocked(getQuote).mockResolvedValueOnce({
      symbol: "AAPL",
      name: "Apple Inc.",
      price: 0,
      change: -200,
      changePercent: -100,
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

    await expect(getHostedInstrumentQuoteSnapshot("AAPL")).resolves.toMatchObject({
      status: "unavailable",
      reason: "provider returned stale or invalid market data",
    });
  });

  it("builds watchlist and portfolio quote rows from browser-owned state", async () => {
    const snapshot = await buildHostedMarketQuoteSnapshot({
      watchlists: [{ id: 1, name: "Default", isDefault: true }],
      portfolios: [{ id: 2, name: "Default", isDefault: true, baseCurrency: "USD" }],
      watchlist: [{ id: 3, instrumentId: 4, symbol: "AAPL", assetType: "equity" }],
      portfolio: [
        {
          id: 5,
          portfolioId: 2,
          instrumentId: 4,
          symbol: "AAPL",
          assetType: "equity",
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
      assetType: "equity",
      status: "ok",
      price: 203,
      dayHigh: 204,
      dayLow: 197,
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
    expect(getHistory).not.toHaveBeenCalled();
  });

  it("rejects zero-filled and malformed history instead of returning an OK chart", async () => {
    vi.mocked(getHistory).mockResolvedValueOnce([
      {
        date: "2026-07-31",
        timestamp: 1_754_000_000,
        open: 0,
        high: 0,
        low: 0,
        close: 0,
        volume: 0,
      },
    ]);
    await expect(getHostedInstrumentHistorySnapshot("AAPL", "1D")).resolves.toMatchObject({
      status: "unavailable",
    });

    vi.mocked(getHistory).mockResolvedValueOnce([
      {
        date: "2026-07-31",
        timestamp: 1_754_000_000,
        open: 198,
        high: Number.NaN,
        low: 197,
        close: 200,
        volume: 1_000,
      },
    ]);
    await expect(getHostedInstrumentHistorySnapshot("AAPL", "1D")).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("rejects internally inconsistent OHLC bars", async () => {
    vi.mocked(getHistory).mockResolvedValueOnce([
      {
        date: "2026-07-31",
        timestamp: 1_754_000_000,
        open: 198,
        high: 197,
        low: 196,
        close: 200,
        volume: 1_000,
      },
    ]);

    await expect(getHostedInstrumentHistorySnapshot("AAPL", "1D")).resolves.toMatchObject({
      status: "unavailable",
      reason: "History contains no usable price bars",
    });
  });

  it("does not invent midnight timestamps for malformed intraday history", async () => {
    vi.mocked(getHistory).mockResolvedValueOnce([
      {
        date: "2026-07-31",
        timestamp: Number.NaN,
        open: 198,
        high: 202,
        low: 197,
        close: 200,
        volume: 1_000,
      },
    ]);

    await expect(getHostedInstrumentHistorySnapshot("AAPL", "1D")).resolves.toMatchObject({
      status: "unavailable",
    });
  });

  it("keeps a previous-period close for weekly and monthly history", async () => {
    const weekly = await getHostedInstrumentHistorySnapshot("AAPL", "5Y");
    expect(weekly).toMatchObject({ status: "ok", interval: "1wk", prevClose: 200 });

    const monthly = await getHostedInstrumentHistorySnapshot("AAPL", "MAX");
    expect(monthly).toMatchObject({ status: "ok", interval: "1mo", prevClose: 200 });
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
          assetType: "equity",
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
    expect(snapshot.portfolioSummary).toMatchObject({
      portfolioId: 2,
      baseCurrency: "USD",
      status: "unavailable",
      totalValue: null,
      totalCost: 200,
      totalPnl: null,
      totalPnlPercent: null,
    });
  });

  it("does not infer a missing quote and instrument currency from the lot currency", async () => {
    vi.mocked(getQuote).mockResolvedValueOnce({
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
      currency: null,
    });

    const snapshot = await buildHostedMarketQuoteSnapshot({
      portfolios: [{ id: 2, name: "Default", isDefault: true, baseCurrency: "USD" }],
      portfolio: [
        {
          id: 5,
          portfolioId: 2,
          instrumentId: 4,
          symbol: "AAPL",
          assetType: "equity",
          quantity: 2,
          avgCost: 180,
          currency: "USD",
          instrumentCurrency: null,
        },
      ],
    });

    expect(snapshot.portfolioQuotes[0]).toMatchObject({
      status: "unavailable",
      currentPrice: null,
      marketValue: null,
      totalCost: 360,
      pnl: null,
      includedInTotals: false,
      reason: "Quote currency unavailable",
    });
    expect(snapshot.portfolioSummary).toMatchObject({
      status: "unavailable",
      totalValue: null,
      totalCost: 360,
      totalPnl: null,
    });
  });

  it("does not present partial base-currency portfolio totals as complete", async () => {
    vi.mocked(getQuote).mockImplementation(async (symbol) => {
      if (symbol === "MSFT") throw new Error("quote unavailable");
      return {
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
      };
    });

    const snapshot = await buildHostedMarketQuoteSnapshot({
      portfolios: [{ id: 2, name: "Default", isDefault: true, baseCurrency: "USD" }],
      portfolio: [
        {
          id: 5,
          portfolioId: 2,
          instrumentId: 4,
          symbol: "AAPL",
          assetType: "equity",
          quantity: 1,
          avgCost: 100,
          currency: "USD",
          instrumentCurrency: "USD",
        },
        {
          id: 6,
          portfolioId: 2,
          instrumentId: 7,
          symbol: "MSFT",
          assetType: "equity",
          quantity: 3,
          avgCost: 300,
          currency: "USD",
          instrumentCurrency: "USD",
        },
      ],
    });

    expect(snapshot.portfolioSummary).toMatchObject({
      status: "unavailable",
      totalValue: null,
      totalCost: 1_000,
      totalPnl: null,
      totalPnlPercent: null,
    });
    expect(snapshot.portfolioQuotes[0]).not.toHaveProperty("allocationPercent");
  });

  it("keeps truly empty portfolio totals at zero", async () => {
    const snapshot = await buildHostedMarketQuoteSnapshot({
      portfolios: [{ id: 2, name: "Default", isDefault: true, baseCurrency: "USD" }],
      portfolio: [],
    });

    expect(snapshot.portfolioSummary).toMatchObject({
      portfolioId: 2,
      status: "empty",
      totalValue: 0,
      totalCost: 0,
      totalPnl: 0,
      totalPnlPercent: 0,
    });
  });

  it("preserves saved watchlist and portfolio rows when the relay is unavailable", () => {
    const snapshot = buildHostedUnavailableMarketQuoteSnapshot(
      {
        portfolios: [{ id: 2, name: "Default", isDefault: true, baseCurrency: "CAD" }],
        watchlist: [{ id: 3, instrumentId: 4, symbol: "AAPL", assetType: "equity" }],
        portfolio: [
          {
            id: 5,
            portfolioId: 2,
            instrumentId: 4,
            symbol: "AAPL",
            assetType: "equity",
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
