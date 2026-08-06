export type MarketQuoteResult =
  | {
      status: "ok";
      name?: string;
      price: number;
      change: number;
      changePercent: number;
      volume: number;
      high: number;
      low: number;
      week52High: number;
      week52Low: number;
      marketCap: number;
      fetchedAt: string;
      dataAsOf?: string;
      marketState?: "PRE" | "REGULAR" | "POST" | "CLOSED";
      extendedPrice?: number;
      extendedChange?: number;
      extendedChangePercent?: number;
      extendedAsOf?: string;
      stale: boolean;
      currency: string | null;
    }
  | { status: "unavailable"; reason: string };

export interface MarketQuoteState {
  watchlists?: Array<{ id: number; isDefault?: boolean; name?: string }>;
  portfolios?: Array<{
    id: number;
    isDefault?: boolean;
    name?: string;
    baseCurrency?: string | null;
  }>;
  watchlist?: Array<{ id: number; instrumentId: number; symbol: string; assetType: string }>;
  portfolio?: Array<{
    id: number;
    portfolioId: number;
    instrumentId: number;
    symbol: string;
    assetType: string;
    quantity: number;
    avgCost: number;
    currency: string;
    instrumentCurrency?: string | null;
  }>;
}

export interface MarketQuoteSnapshotDependencies {
  fetchQuote(symbol: string): Promise<MarketQuoteResult>;
  now?: () => Date;
}

export const MARKET_INDEX_SYMBOLS = ["^GSPC", "^NDX", "^DJI", "BTC-USD"] as const;

const MARKET_INDEX_ASSET_TYPES = {
  "^GSPC": "index",
  "^NDX": "index",
  "^DJI": "index",
  "BTC-USD": "crypto",
} as const;

export async function buildMarketIndicesSnapshot(
  dependencies: Pick<MarketQuoteSnapshotDependencies, "fetchQuote">,
) {
  const indices = [];
  for (const symbol of MARKET_INDEX_SYMBOLS) {
    const quote = await dependencies.fetchQuote(symbol);
    const assetType = MARKET_INDEX_ASSET_TYPES[symbol];
    if (quote.status === "unavailable") {
      indices.push({ symbol, assetType, status: "unavailable" as const, reason: quote.reason });
      continue;
    }
    indices.push({
      symbol,
      assetType,
      name: quote.name,
      status: "ok" as const,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      currency: quote.currency,
      marketState: quote.marketState,
      dataAsOf: quote.dataAsOf,
      stale: quote.stale,
    });
  }
  return { generatedAt: new Date().toISOString(), indices };
}

export type MarketIndicesSnapshot = Awaited<ReturnType<typeof buildMarketIndicesSnapshot>>;

export async function buildMarketQuoteSnapshot(
  state: MarketQuoteState,
  dependencies: MarketQuoteSnapshotDependencies,
) {
  const watchlist = state.watchlist ?? [];
  const portfolios = state.portfolios ?? [];
  const lots = state.portfolio ?? [];
  const symbols = [
    ...new Set([...watchlist.map((item) => item.symbol), ...lots.map((lot) => lot.symbol)]),
  ];
  const quoteMap = new Map<string, MarketQuoteResult>();
  for (const symbol of symbols) {
    const quote = await dependencies.fetchQuote(symbol);
    quoteMap.set(symbol, quote);
  }

  const watchlistQuotes = watchlist.map((item) => {
    const quote = quoteMap.get(item.symbol);
    if (!quote || quote.status === "unavailable") {
      return {
        itemId: item.id,
        instrumentId: item.instrumentId,
        symbol: item.symbol,
        assetType: item.assetType,
        status: "unavailable" as const,
        reason: quote?.reason ?? "quote unavailable",
      };
    }
    return {
      itemId: item.id,
      instrumentId: item.instrumentId,
      symbol: item.symbol,
      assetType: item.assetType,
      name: quote.name,
      status: "ok" as const,
      price: quote.price,
      change: quote.change,
      changePercent: quote.changePercent,
      volume: quote.volume,
      dayHigh: quote.high,
      dayLow: quote.low,
      week52High: quote.week52High,
      week52Low: quote.week52Low,
      currency: quote.currency,
      fetchedAt: quote.fetchedAt,
      dataAsOf: quote.dataAsOf,
      marketState: quote.marketState,
      extendedPrice: quote.extendedPrice,
      extendedChange: quote.extendedChange,
      extendedChangePercent: quote.extendedChangePercent,
      extendedAsOf: quote.extendedAsOf,
      stale: quote.stale,
    };
  });

  const portfolioResults = portfolios.map((portfolio) => {
    const baseCurrency = portfolio.baseCurrency ?? "USD";
    const portfolioLots = lots.filter((lot) => lot.portfolioId === portfolio.id);
    const quotes = portfolioLots.map((lot) => {
      const quote = quoteMap.get(lot.symbol);
      const totalCost = lot.avgCost * lot.quantity;
      const quoteCurrency =
        quote?.status === "ok" ? (quote.currency ?? lot.instrumentCurrency) : null;
      const common = {
        lotId: lot.id,
        portfolioId: lot.portfolioId,
        instrumentId: lot.instrumentId,
        symbol: lot.symbol,
        assetType: lot.assetType,
        totalCost,
        currency: lot.currency,
      };
      if (!quote || quote.status === "unavailable") {
        return {
          ...common,
          status: "unavailable" as const,
          includedInTotals: false,
          reason: quote?.reason ?? "quote unavailable",
        };
      }
      const quoteMetadata = {
        fetchedAt: quote.fetchedAt,
        dataAsOf: quote.dataAsOf,
        marketState: quote.marketState,
        extendedPrice: quote.extendedPrice,
        extendedChange: quote.extendedChange,
        extendedChangePercent: quote.extendedChangePercent,
        extendedAsOf: quote.extendedAsOf,
        stale: quote.stale,
      };
      if (!quoteCurrency) {
        return {
          ...common,
          ...quoteMetadata,
          status: "unavailable" as const,
          currentPrice: null,
          marketValue: null,
          pnl: null,
          pnlPercent: null,
          includedInTotals: false,
          reason: "Quote currency unavailable",
        };
      }
      if (quoteCurrency !== lot.currency) {
        return {
          ...common,
          ...quoteMetadata,
          status: "unavailable" as const,
          currentPrice: null,
          marketValue: null,
          pnl: null,
          pnlPercent: null,
          includedInTotals: false,
          reason: `No FX conversion from ${quoteCurrency} to ${lot.currency}`,
        };
      }
      const includedInTotals = lot.currency === baseCurrency;
      const marketValue = quote.price * lot.quantity;
      return {
        ...common,
        ...quoteMetadata,
        name: quote.name,
        status: "ok" as const,
        currentPrice: quote.price,
        changePercent: quote.changePercent,
        marketValue,
        pnl: marketValue - totalCost,
        pnlPercent: totalCost > 0 ? ((marketValue - totalCost) / totalCost) * 100 : 0,
        includedInTotals,
        reason: includedInTotals
          ? undefined
          : `No FX conversion from ${lot.currency} to ${baseCurrency}`,
      };
    });
    const included = quotes.filter((quote) => quote.status === "ok" && quote.includedInTotals);
    const totalValue = included.reduce((sum, quote) => sum + (quote.marketValue ?? 0), 0);
    const includedCost = included.reduce((sum, quote) => sum + quote.totalCost, 0);
    const baseCurrencyCost = quotes
      .filter((quote) => quote.currency === baseCurrency)
      .reduce((sum, quote) => sum + quote.totalCost, 0);
    const incompleteBaseCurrency = quotes.some(
      (quote) =>
        quote.currency === baseCurrency && !(quote.status === "ok" && quote.includedInTotals),
    );
    const status =
      portfolioLots.length === 0
        ? ("empty" as const)
        : included.length === 0 || incompleteBaseCurrency
          ? ("unavailable" as const)
          : ("ok" as const);
    const allocatedQuotes = quotes.map((quote) =>
      status === "ok" && quote.status === "ok" && quote.includedInTotals && totalValue > 0
        ? { ...quote, allocationPercent: ((quote.marketValue ?? 0) / totalValue) * 100 }
        : quote,
    );
    const summaryTotalValue = status === "unavailable" ? null : totalValue;
    const summaryTotalCost = status === "unavailable" ? baseCurrencyCost : includedCost;
    return {
      quotes: allocatedQuotes,
      summary: {
        portfolioId: portfolio.id,
        baseCurrency,
        status,
        totalValue: summaryTotalValue,
        totalCost: summaryTotalCost,
        totalPnl: summaryTotalValue == null ? null : summaryTotalValue - summaryTotalCost,
        totalPnlPercent:
          summaryTotalValue == null
            ? null
            : summaryTotalCost > 0
              ? ((summaryTotalValue - summaryTotalCost) / summaryTotalCost) * 100
              : 0,
        excludedFromTotals: allocatedQuotes
          .filter((quote) => quote.status !== "ok" || !quote.includedInTotals)
          .map((quote) => ({
            symbol: quote.symbol,
            currency: quote.currency,
            reason: quote.reason ?? "quote unavailable",
          })),
      },
    };
  });

  const defaultPortfolio = portfolios.find((portfolio) => portfolio.isDefault) ?? portfolios[0];
  const defaultResult =
    portfolioResults.find((result) => result.summary.portfolioId === defaultPortfolio?.id) ??
    portfolioResults[0];
  const emptySummary = createEmptySummary(defaultPortfolio);
  return {
    generatedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    watchlistQuotes,
    portfolioQuotes: portfolioResults.flatMap((result) => result.quotes),
    portfolioSummary: defaultResult?.summary ?? emptySummary,
    portfolioSummaries: portfolioResults.map((result) => result.summary),
  };
}

export function buildUnavailableMarketQuoteSnapshot(state: MarketQuoteState, reason: string) {
  return buildMarketQuoteSnapshotFromUnavailableState(state, reason, new Date());
}

function buildMarketQuoteSnapshotFromUnavailableState(
  state: MarketQuoteState,
  reason: string,
  generatedAt: Date,
) {
  const portfolios = state.portfolios ?? [];
  const watchlistQuotes = (state.watchlist ?? []).map((item) => ({
    itemId: item.id,
    instrumentId: item.instrumentId,
    symbol: item.symbol,
    assetType: item.assetType,
    status: "unavailable" as const,
    reason,
  }));
  const portfolioResults = portfolios.map((portfolio) => {
    const baseCurrency = portfolio.baseCurrency ?? "USD";
    const quotes = (state.portfolio ?? [])
      .filter((lot) => lot.portfolioId === portfolio.id)
      .map((lot) => ({
        lotId: lot.id,
        portfolioId: lot.portfolioId,
        instrumentId: lot.instrumentId,
        symbol: lot.symbol,
        assetType: lot.assetType,
        status: "unavailable" as const,
        totalCost: lot.avgCost * lot.quantity,
        currency: lot.currency,
        includedInTotals: false,
        reason,
      }));
    return {
      quotes,
      summary: {
        portfolioId: portfolio.id,
        baseCurrency,
        status: quotes.length > 0 ? ("unavailable" as const) : ("empty" as const),
        totalValue: quotes.length > 0 ? null : 0,
        totalCost: quotes
          .filter((quote) => quote.currency === baseCurrency)
          .reduce((sum, quote) => sum + quote.totalCost, 0),
        totalPnl: quotes.length > 0 ? null : 0,
        totalPnlPercent: quotes.length > 0 ? null : 0,
        excludedFromTotals: quotes.map((quote) => ({
          symbol: quote.symbol,
          currency: quote.currency,
          reason,
        })),
      },
    };
  });
  const defaultPortfolio = portfolios.find((portfolio) => portfolio.isDefault) ?? portfolios[0];
  const defaultResult =
    portfolioResults.find((result) => result.summary.portfolioId === defaultPortfolio?.id) ??
    portfolioResults[0];
  return {
    generatedAt: generatedAt.toISOString(),
    watchlistQuotes,
    portfolioQuotes: portfolioResults.flatMap((result) => result.quotes),
    portfolioSummary: defaultResult?.summary ?? createEmptySummary(defaultPortfolio),
    portfolioSummaries: portfolioResults.map((result) => result.summary),
  };
}

function createEmptySummary(portfolio?: { id: number; baseCurrency?: string | null }) {
  return {
    portfolioId: portfolio?.id ?? 0,
    baseCurrency: portfolio?.baseCurrency ?? "USD",
    status: "empty" as const,
    totalValue: 0,
    totalCost: 0,
    totalPnl: 0,
    totalPnlPercent: 0,
    excludedFromTotals: [] as Array<{ symbol: string; currency: string; reason: string }>,
  };
}

export type MarketStateQuoteSnapshot = Awaited<ReturnType<typeof buildMarketQuoteSnapshot>>;
