import { useEffect, useMemo, useState } from "react";
import { useInstrumentHistory } from "../../hooks/useInstrumentHistory.jsx";
import { useMarketState } from "../../hooks/useMarketState.jsx";
import { useRuntimeTransport } from "../../runtime/runtime-transport-context.js";
import { buildAlertSentenceRows } from "../market-state/alert-view-model.js";
import { buildHoldingRows } from "../market-state/portfolio-view-model.js";
import { resolveAssetDescriptor } from "./asset-descriptor.js";
import { buildSymbolViewModel } from "./symbol-view-model.js";

// The chart range is the reader's choice; the derived stats always need daily
// bars over a full year, so they read their own fixed range instead of
// recomputing themselves whenever the chart range changes.
const DERIVED_HISTORY_RANGE = "1Y";

export function deriveSymbolContext(state = {}, ticker = "") {
  const symbol = ticker.trim().toUpperCase();
  const instrument = (state.instruments ?? []).find(
    (candidate) => candidate.symbol?.toUpperCase() === symbol,
  );
  const instrumentId = instrument?.id ?? null;
  const instrumentRecord = instrument ?? null;
  const positionRows = buildHoldingRows(
    (state.portfolio ?? []).filter((lot) => lot.symbol?.toUpperCase() === symbol),
    state.quoteSnapshot?.portfolioQuotes ?? [],
  );
  const alertRows = buildAlertSentenceRows(
    (state.alerts ?? []).filter((rule) => rule.instrumentId === instrumentId),
    state.alertEvents ?? [],
    state.instruments ?? [],
  );
  const watchlistsById = new Map(
    (state.watchlists ?? []).map((watchlist) => [watchlist.id, watchlist.name]),
  );
  const memberships = (state.watchlist ?? [])
    .filter((item) => item.symbol?.toUpperCase() === symbol)
    .map((item) => ({
      ...item,
      watchlistName: watchlistsById.get(item.watchlistId) ?? "Watchlist",
    }));
  const stateQuote = (state.quoteSnapshot?.watchlistQuotes ?? []).find(
    (candidate) => candidate.symbol?.toUpperCase() === symbol,
  );

  return {
    symbol,
    instrument: instrumentRecord,
    instrumentId,
    positionRows,
    alertRows,
    memberships,
    stateQuote,
  };
}

export function useSymbolData(ticker, range = "1M") {
  const symbol = ticker.trim().toUpperCase();
  const marketState = useMarketState();
  const quote = useSymbolEndpoint("quote", symbol);
  const overview = useSymbolEndpoint("overview", symbol);
  const history = useInstrumentHistory(symbol, range);
  const derivedHistory = useInstrumentHistory(symbol, DERIVED_HISTORY_RANGE);
  const instrumentType = useInstrumentTypeCandidates(symbol);
  const context = useMemo(
    () => deriveSymbolContext(marketState.state, symbol),
    [marketState.state, symbol],
  );
  const resolvedQuote = context.stateQuote ?? quote.snapshot;
  const descriptor = useMemo(
    () =>
      resolveAssetDescriptor({
        symbol,
        searchCandidates: instrumentType.candidates,
        instrument: context.instrument,
        overview: overview.snapshot,
      }),
    [symbol, instrumentType.candidates, context.instrument, overview.snapshot],
  );
  const viewModel = useMemo(
    () =>
      buildSymbolViewModel({
        bars: derivedHistory.snapshot?.status === "ok" ? derivedHistory.snapshot.bars : [],
        quote: resolvedQuote,
        // A retained copy served while the provider is unreachable still
        // produces levels and averages; the page has to say so rather than
        // presenting them as today's market context.
        historyStale: derivedHistory.snapshot?.stale === true,
        historyAsOf: derivedHistory.snapshot?.dataAsOf,
      }),
    [derivedHistory.snapshot, resolvedQuote],
  );

  return {
    ...context,
    state: marketState.state,
    quote: resolvedQuote,
    overview: overview.snapshot,
    history: history.snapshot,
    descriptor,
    viewModel,
    derivedHistory: derivedHistory.snapshot,
    // Kept apart from `loading` so the sections that already render do not wait
    // on the derived stats.
    viewModelLoading: derivedHistory.loading,
    assetTypeLoading: instrumentType.loading,
    loading:
      marketState.loading ||
      (quote.loading && !context.stateQuote) ||
      overview.loading ||
      history.loading,
    quoteLoading: quote.loading && !context.stateQuote,
    overviewLoading: overview.loading,
    historyLoading: history.loading,
    error: marketState.error || quote.error || overview.error || history.error,
    refresh: marketState.refresh,
    refreshQuotes: marketState.refreshQuotes,
  };
}

const NO_CANDIDATES = [];

/**
 * Instrument-type metadata for one symbol, read from the same instrument search
 * both surfaces already serve. A runtime without search, or a search that
 * fails, leaves the descriptor to resolve honestly as unknown instead of
 * guessing a type from the ticker string.
 */
export function useInstrumentTypeCandidates(symbol) {
  const transport = useRuntimeTransport();
  const [state, setState] = useState({ key: symbol, candidates: NO_CANDIDATES, loading: true });

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      setState({ key: symbol, candidates: NO_CANDIDATES, loading: true });
      if (!symbol || typeof transport?.searchInstruments !== "function") {
        if (!disposed) setState({ key: symbol, candidates: NO_CANDIDATES, loading: false });
        return;
      }
      try {
        const data = await transport.searchInstruments(symbol);
        if (!disposed) {
          setState({
            key: symbol,
            candidates: Array.isArray(data?.candidates) ? data.candidates : NO_CANDIDATES,
            loading: false,
          });
        }
      } catch {
        // An unreachable search is not a page error: it only means the page
        // cannot name this instrument's type yet.
        if (!disposed) setState({ key: symbol, candidates: NO_CANDIDATES, loading: false });
      }
    };
    void run();
    return () => {
      disposed = true;
    };
  }, [symbol, transport]);

  return state.key === symbol
    ? { candidates: state.candidates, loading: state.loading }
    : { candidates: NO_CANDIDATES, loading: true };
}

export function useSymbolEndpoint(endpoint, symbol) {
  const transport = useRuntimeTransport();
  const requestKey = `${endpoint}:${symbol}`;
  const [state, setState] = useState({
    key: requestKey,
    snapshot: null,
    loading: true,
    error: null,
  });

  useEffect(() => {
    let disposed = false;
    const run = async () => {
      setState({ key: requestKey, snapshot: null, loading: true, error: null });
      try {
        const data =
          endpoint === "quote"
            ? await transport.getInstrumentQuote(symbol)
            : await transport.getInstrumentEndpoint(endpoint, symbol);
        if (!disposed) setState({ key: requestKey, snapshot: data, loading: false, error: null });
      } catch (err) {
        if (!disposed) {
          setState({
            key: requestKey,
            snapshot: null,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    };
    void run();
    return () => {
      disposed = true;
    };
  }, [endpoint, symbol, requestKey, transport]);

  return state.key === requestKey
    ? { snapshot: state.snapshot, loading: state.loading, error: state.error }
    : { snapshot: null, loading: true, error: null };
}
