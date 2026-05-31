import { useCallback, useEffect, useMemo, useState } from "react";

const EMPTY_MARKET_STATE = {
  watchlist: [],
  portfolio: [],
  predictions: [],
  alerts: [],
  alertEvents: [],
  reportTemplates: [],
  reportRuns: [],
  quoteSnapshot: null,
};

export function mergeMarketStateSnapshot(current, data) {
  return {
    ...EMPTY_MARKET_STATE,
    ...data,
    quoteSnapshot: Object.prototype.hasOwnProperty.call(data, "quoteSnapshot")
      ? data.quoteSnapshot
      : current?.quoteSnapshot ?? null,
  };
}

export function useMarketState({ pollMs = 4000 } = {}) {
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

  return useMemo(
    () => ({ state, loading, error, refresh, refreshQuotes }),
    [state, loading, error, refresh, refreshQuotes],
  );
}

export async function searchInstruments(query) {
  const trimmed = String(query ?? "").trim();
  if (!trimmed) return [];
  const response = await fetch(`/api/instruments/search?q=${encodeURIComponent(trimmed)}`);
  if (!response.ok) throw new Error(response.statusText || "Search failed");
  const data = await response.json();
  return data.candidates || [];
}
