import { useCallback, useEffect, useMemo, useState } from "react";

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
    ? data.quoteSnapshot
    : mergePreservedQuoteSnapshot(current, data);
  return {
    ...EMPTY_MARKET_STATE,
    ...data,
    quoteSnapshot,
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
  const [state, setState] = useState(EMPTY_MARKET_STATE);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/market-state");
      if (!response.ok) throw new Error(response.statusText || "Failed to load market state");
      const data = await response.json();
      setState((current) => mergeMarketStateSnapshot(current, data));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshQuotes = useCallback(async () => {
    try {
      const response = await fetch("/api/market-state/quotes");
      if (!response.ok) throw new Error(response.statusText || "Failed to load market quotes");
      const quoteSnapshot = await response.json();
      setState((current) => ({ ...current, quoteSnapshot }));
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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
