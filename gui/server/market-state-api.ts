import type Database from "better-sqlite3";
import { isZeroFilledQuote, searchYahooInstruments } from "../../src/market-state/resolve.js";
import { MarketStateService } from "../../src/market-state/service.js";
import { initDefaultDatabase } from "../../src/memory/sqlite.js";
import { wrapProvider } from "../../src/providers/wrap-provider.js";
import { getQuote } from "../../src/providers/yahoo-finance.js";

export interface MarketStateSnapshot {
  instruments: Array<NonNullable<ReturnType<MarketStateService["getInstrument"]>>>;
  watchlist: ReturnType<MarketStateService["listWatchlistItems"]>;
  portfolio: ReturnType<MarketStateService["listPortfolioLots"]>;
  alerts: ReturnType<MarketStateService["listAlertRules"]>;
  alertEvents: ReturnType<MarketStateService["listAlertEvents"]>;
  alertCheckRuns: ReturnType<MarketStateService["listAlertCheckRuns"]>;
  reportTemplates: ReturnType<MarketStateService["listReportTemplates"]>;
  reportRuns: ReturnType<MarketStateService["listReportRuns"]>;
  runnerLease: ReturnType<MarketStateService["getAutomationRunnerLease"]>;
  notifications: ReturnType<MarketStateService["listNotificationEvents"]>;
  notificationDeliveryAttempts: ReturnType<MarketStateService["listNotificationDeliveryAttempts"]>;
}

export interface MarketStateQuoteSnapshot {
  generatedAt: string;
  watchlistQuotes: Array<{
    itemId: number;
    instrumentId: number;
    symbol: string;
    status: "ok" | "unavailable";
    price?: number;
    changePercent?: number;
    fetchedAt?: string;
    stale?: boolean;
    reason?: string;
  }>;
  portfolioQuotes: Array<{
    lotId: number;
    instrumentId: number;
    symbol: string;
    status: "ok" | "unavailable";
    currentPrice?: number;
    changePercent?: number;
    marketValue?: number;
    totalCost: number;
    pnl?: number;
    pnlPercent?: number;
    allocationPercent?: number;
    currency: string;
    includedInTotals: boolean;
    fetchedAt?: string;
    stale?: boolean;
    reason?: string;
  }>;
  portfolioSummary: {
    baseCurrency: string;
    totalValue: number;
    totalCost: number;
    totalPnl: number;
    totalPnlPercent: number;
    excludedFromTotals: Array<{ symbol: string; currency: string; reason: string }>;
  };
}

export function buildMarketStateSnapshot(db?: Database.Database): MarketStateSnapshot {
  const ownedDb = db ?? initDefaultDatabase();
  const service = new MarketStateService(ownedDb);
  try {
    const alerts = service.listAlertRules();
    const instrumentIds = [
      ...new Set(alerts.map((rule) => rule.instrumentId).filter((id) => id != null)),
    ];
    return {
      instruments: instrumentIds
        .map((id) => service.getInstrument(id))
        .filter((instrument) => instrument != null),
      watchlist: service.listWatchlistItems(),
      portfolio: service.listPortfolioLots(),
      alerts,
      alertEvents: service.listAlertEvents(),
      alertCheckRuns: service.listAlertCheckRuns(),
      reportTemplates: service.listReportTemplates(),
      reportRuns: service.listReportRuns(),
      runnerLease: service.getAutomationRunnerLease(),
      notifications: service.listNotificationEvents(),
      notificationDeliveryAttempts: service.listNotificationDeliveryAttempts(),
    };
  } finally {
    if (!db) ownedDb.close();
  }
}

export async function buildMarketStateQuoteSnapshot(
  db?: Database.Database,
): Promise<MarketStateQuoteSnapshot> {
  const ownedDb = db ?? initDefaultDatabase();
  const service = new MarketStateService(ownedDb);
  try {
    const watchlist = service.listWatchlistItems();
    const portfolio = service.listPortfolioLots();
    const symbols = [
      ...new Set([...watchlist.map((item) => item.symbol), ...portfolio.map((lot) => lot.symbol)]),
    ];
    const quoteMap = new Map<string, Awaited<ReturnType<typeof fetchQuoteSnapshot>>>();
    for (const symbol of symbols) {
      quoteMap.set(symbol, await fetchQuoteSnapshot(symbol));
    }

    const generatedAt = new Date().toISOString();
    const watchlistQuotes = watchlist.map((item) => {
      const quote = quoteMap.get(item.symbol);
      if (quote == null || quote.status === "unavailable") {
        return {
          itemId: item.id,
          instrumentId: item.instrumentId,
          symbol: item.symbol,
          status: "unavailable" as const,
          reason: quote?.reason ?? "quote unavailable",
        };
      }
      return {
        itemId: item.id,
        instrumentId: item.instrumentId,
        symbol: item.symbol,
        status: "ok" as const,
        price: quote.price,
        changePercent: quote.changePercent,
        fetchedAt: quote.fetchedAt,
        stale: quote.stale,
      };
    });

    const baseCurrency = service.getDefaultPortfolio().baseCurrency ?? "USD";
    const portfolioQuotes = portfolio.map((lot) => {
      const quote = quoteMap.get(lot.symbol);
      const lotCurrency = lot.currency || baseCurrency;
      const quoteCurrency = lot.instrumentCurrency || lotCurrency;
      const includedInTotals = lotCurrency === baseCurrency && quoteCurrency === baseCurrency;
      const totalCost = lot.avgCost * lot.quantity;
      if (quote == null || quote.status === "unavailable") {
        return {
          lotId: lot.id,
          instrumentId: lot.instrumentId,
          symbol: lot.symbol,
          status: "unavailable" as const,
          totalCost,
          currency: lotCurrency,
          includedInTotals: false,
          reason: quote?.reason ?? "quote unavailable",
        };
      }
      const resolvedQuoteCurrency = quote.currency ?? quoteCurrency;
      if (resolvedQuoteCurrency !== lotCurrency) {
        return {
          lotId: lot.id,
          instrumentId: lot.instrumentId,
          symbol: lot.symbol,
          status: "unavailable" as const,
          currentPrice: null,
          marketValue: null,
          totalCost,
          pnl: null,
          pnlPercent: null,
          currency: lotCurrency,
          includedInTotals: false,
          reason: `No FX conversion from ${resolvedQuoteCurrency} to ${lotCurrency}`,
          fetchedAt: quote.fetchedAt,
          stale: quote.stale,
        };
      }
      const marketValue = quote.price * lot.quantity;
      return {
        lotId: lot.id,
        instrumentId: lot.instrumentId,
        symbol: lot.symbol,
        status: "ok" as const,
        currentPrice: quote.price,
        changePercent: quote.changePercent,
        marketValue,
        totalCost,
        pnl: marketValue - totalCost,
        pnlPercent: totalCost > 0 ? ((marketValue - totalCost) / totalCost) * 100 : 0,
        currency: lotCurrency,
        includedInTotals,
        fetchedAt: quote.fetchedAt,
        stale: quote.stale,
        reason: includedInTotals
          ? undefined
          : `No FX conversion from ${lotCurrency === baseCurrency ? quoteCurrency : lotCurrency} to ${baseCurrency}`,
      };
    });
    const included = portfolioQuotes.filter(
      (quote) => quote.status === "ok" && quote.includedInTotals,
    );
    const totalValue = included.reduce((sum, quote) => sum + (quote.marketValue ?? 0), 0);
    const totalCost = included.reduce((sum, quote) => sum + quote.totalCost, 0);
    const portfolioQuotesWithAllocation = portfolioQuotes.map((quote) => {
      if (quote.status !== "ok" || !quote.includedInTotals || totalValue <= 0) return quote;
      return {
        ...quote,
        allocationPercent: ((quote.marketValue ?? 0) / totalValue) * 100,
      };
    });
    const excludedFromTotals = portfolioQuotesWithAllocation
      .filter((quote) => quote.status !== "ok" || !quote.includedInTotals)
      .map((quote) => ({
        symbol: quote.symbol,
        currency: quote.currency,
        reason: quote.reason ?? "quote unavailable",
      }));
    return {
      generatedAt,
      watchlistQuotes,
      portfolioQuotes: portfolioQuotesWithAllocation,
      portfolioSummary: {
        baseCurrency,
        totalValue,
        totalCost,
        totalPnl: totalValue - totalCost,
        totalPnlPercent: totalCost > 0 ? ((totalValue - totalCost) / totalCost) * 100 : 0,
        excludedFromTotals,
      },
    };
  } finally {
    if (!db) ownedDb.close();
  }
}

export async function searchInstrumentCandidates(query: string): Promise<{
  query: string;
  candidates: Awaited<ReturnType<typeof searchYahooInstruments>>;
  error?: string;
}> {
  const trimmed = query.trim();
  if (!trimmed) return { query: "", candidates: [] };
  try {
    return {
      query: trimmed,
      candidates: await searchYahooInstruments(trimmed),
    };
  } catch (err) {
    return {
      query: trimmed,
      candidates: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function fetchQuoteSnapshot(symbol: string): Promise<
  | {
      status: "ok";
      price: number;
      changePercent: number;
      fetchedAt: string;
      stale?: boolean;
      currency: string | null;
    }
  | { status: "unavailable"; reason: string }
> {
  const result = await wrapProvider("yahoo", () => getQuote(symbol));
  if (result.status === "unavailable") return { status: "unavailable", reason: result.reason };
  if (result.stale) return { status: "unavailable", reason: "provider returned stale market data" };
  if (isZeroFilledQuote(result.data)) {
    return { status: "unavailable", reason: "Yahoo returned no valid market data." };
  }
  return {
    status: "ok",
    price: result.data.price,
    changePercent: result.data.changePercent,
    fetchedAt: result.timestamp,
    stale: result.stale,
    currency: result.data.currency ?? null,
  };
}
