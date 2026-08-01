import { useCallback, useEffect, useMemo, useState } from "react";
import { useRuntimeTransport } from "../runtime/runtime-transport-context.js";

export const MARKET_STATE_POLL_MS = 4000;
export const QUOTE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const EMPTY_MARKET_STATE = {
  instruments: [],
  watchlists: [],
  portfolios: [],
  watchlist: [],
  portfolio: [],
  alerts: [],
  alertEvents: [],
  alertCheckRuns: [],
  reportTemplates: [],
  reportRuns: [],
  runnerLease: null,
  notifications: [],
  notificationDeliveryAttempts: [],
  quoteSnapshot: null,
};

export function mergeMarketStateSnapshot(current, data) {
  const quoteSnapshot = Object.hasOwn(data, "quoteSnapshot")
    ? mergeQuoteRefreshSnapshot(current?.quoteSnapshot, data.quoteSnapshot)
    : mergePreservedQuoteSnapshot(current, data);
  return {
    ...EMPTY_MARKET_STATE,
    ...data,
    quoteSnapshot,
  };
}

export function mergeQuoteRefreshSnapshot(current, refreshed) {
  if (!current || !refreshed) return refreshed ?? current ?? null;
  const refreshFailedAt = refreshed.generatedAt;
  const watchlistQuotes = mergeQuoteRows(
    current.watchlistQuotes,
    refreshed.watchlistQuotes,
    "itemId",
    refreshFailedAt,
  );
  const portfolioQuotes = mergeQuoteRows(
    current.portfolioQuotes,
    refreshed.portfolioQuotes,
    "lotId",
    refreshFailedAt,
  );
  const stalePortfolioIds = new Set(
    portfolioQuotes
      .filter((quote) => quote?.refreshStatus === "unavailable")
      .map((quote) => quote.portfolioId),
  );
  const portfolioSummaries = mergePortfolioSummaries(
    current.portfolioSummaries,
    refreshed.portfolioSummaries,
    stalePortfolioIds,
    refreshFailedAt,
  );
  const portfolioSummary = mergePortfolioSummary(
    current.portfolioSummary,
    refreshed.portfolioSummary,
    stalePortfolioIds,
    refreshFailedAt,
  );
  const retainedUnavailable =
    watchlistQuotes.some((quote) => quote?.refreshStatus === "unavailable") ||
    portfolioQuotes.some((quote) => quote?.refreshStatus === "unavailable");
  return {
    ...refreshed,
    ...(Object.hasOwn(refreshed, "watchlistQuotes") ? { watchlistQuotes } : {}),
    ...(Object.hasOwn(refreshed, "portfolioQuotes") ? { portfolioQuotes } : {}),
    ...(Object.hasOwn(refreshed, "portfolioSummary") ? { portfolioSummary } : {}),
    ...(Object.hasOwn(refreshed, "portfolioSummaries") ? { portfolioSummaries } : {}),
    ...(retainedUnavailable
      ? {
          lastSuccessfulGeneratedAt:
            current.lastSuccessfulGeneratedAt ?? current.generatedAt ?? null,
        }
      : {}),
  };
}

function mergeQuoteRows(currentRows = [], refreshedRows = [], identityKey, refreshFailedAt) {
  const currentById = new Map(currentRows.map((quote) => [quote?.[identityKey], quote]));
  return refreshedRows.map((quote) => {
    const current = currentById.get(quote?.[identityKey]);
    if (quote?.status !== "unavailable" || current?.status !== "ok") return quote;
    return {
      ...current,
      stale: true,
      refreshStatus: "unavailable",
      refreshReason: quote.reason || "Quote refresh unavailable",
      refreshFailedAt,
    };
  });
}

function mergePortfolioSummaries(
  currentSummaries = [],
  refreshedSummaries = [],
  stalePortfolioIds,
  refreshFailedAt,
) {
  const currentById = new Map(currentSummaries.map((summary) => [summary.portfolioId, summary]));
  return refreshedSummaries.map((summary) =>
    stalePortfolioIds.has(summary.portfolioId)
      ? retainPortfolioSummary(currentById.get(summary.portfolioId), summary, refreshFailedAt)
      : summary,
  );
}

function mergePortfolioSummary(current, refreshed, stalePortfolioIds, refreshFailedAt) {
  if (!refreshed || !stalePortfolioIds.has(refreshed.portfolioId)) return refreshed;
  return retainPortfolioSummary(current, refreshed, refreshFailedAt);
}

function retainPortfolioSummary(current, refreshed, refreshFailedAt) {
  if (!current || current.status === "unavailable") return refreshed;
  return {
    ...current,
    stale: true,
    refreshStatus: "unavailable",
    refreshReason: refreshed?.reason || "Quote refresh unavailable",
    refreshFailedAt,
  };
}

function mergePreservedQuoteSnapshot(current, data) {
  const quoteSnapshot = current?.quoteSnapshot ?? null;
  if (!quoteSnapshot) return null;
  if (!Object.hasOwn(data, "portfolio")) return quoteSnapshot;
  if (portfolioSignature(current?.portfolio ?? []) === portfolioSignature(data.portfolio ?? [])) {
    return quoteSnapshot;
  }
  return {
    ...quoteSnapshot,
    portfolioQuotes: [],
    portfolioSummary: null,
  };
}

function portfolioSignature(portfolio) {
  return portfolio
    .map((lot) =>
      [lot.id, lot.instrumentId, lot.symbol, lot.quantity, lot.avgCost, lot.currency].join(":"),
    )
    .sort()
    .join("|");
}

export function useMarketState({
  pollMs = MARKET_STATE_POLL_MS,
  quotePollMs = QUOTE_REFRESH_INTERVAL_MS,
} = {}) {
  const transport = useRuntimeTransport();
  const [state, setState] = useState(EMPTY_MARKET_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const data = await transport.getMarketState();
      setState((current) => mergeMarketStateSnapshot(current, data));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [transport]);

  const refreshQuotes = useCallback(async () => {
    try {
      const quoteSnapshot = await transport.getMarketQuotes();
      setState((current) => ({
        ...current,
        quoteSnapshot: mergeQuoteRefreshSnapshot(current.quoteSnapshot, quoteSnapshot),
      }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [transport]);

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      if (!disposed) await refresh();
    };
    void run();
    const timer = window.setInterval(run, pollMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [pollMs, refresh]);

  // Fetch quotes as soon as a price-aware surface renders, then keep long-lived
  // pages fresh without surfacing age badges in the UI.
  useEffect(() => {
    let disposed = false;
    const run = async () => {
      if (!disposed) await refreshQuotes();
    };
    void run();
    const timer = window.setInterval(run, quotePollMs);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [quotePollMs, refreshQuotes]);

  return useMemo(
    () => ({ state, loading, error, refresh, refreshQuotes }),
    [state, loading, error, refresh, refreshQuotes],
  );
}
