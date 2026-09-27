import { useEffect, useMemo, useState } from "react";
import { loopbackRuntimeTransport } from "../runtime/runtime-transport.js";
import { useRuntimeTransport } from "../runtime/runtime-transport-context.js";
import { QUOTE_REFRESH_INTERVAL_MS } from "./useMarketState.jsx";

const INITIAL_STATE = { loading: true, quotes: [], unavailable: false };
// A failed refresh retries on a short backoff instead of waiting a full poll
// interval, so a transient failure (for example a hosted writer handoff on
// page load) does not hide the strip for minutes.
export const MARKET_INDICES_RETRY_DELAYS_MS = [2_000, 5_000, 15_000];

export class MarketIndicesStore {
  constructor({ pollMs = QUOTE_REFRESH_INTERVAL_MS, transport = loopbackRuntimeTransport } = {}) {
    this.pollMs = pollMs;
    this.transport = transport;
    this.state = INITIAL_STATE;
    this.listeners = new Set();
    this.timer = null;
    this.retryTimer = null;
    this.retryAttempt = 0;
    this.lastGoodQuotes = null;
  }

  getState() {
    return this.state;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh() {
    let quotes = [];
    try {
      const snapshot = await this.transport.getMarketIndices();
      quotes = (snapshot.indices ?? []).filter((quote) => quote?.status === "ok");
    } catch {
      quotes = [];
    }
    if (quotes.length > 0) {
      this.lastGoodQuotes = quotes;
      this.retryAttempt = 0;
      this.clearRetry();
      this.setState({ loading: false, quotes, unavailable: false });
      return;
    }
    // Keep the last good prices through a transient failure; only report the
    // strip unavailable when no refresh has ever succeeded.
    if (this.lastGoodQuotes) {
      this.setState({ loading: false, quotes: this.lastGoodQuotes, unavailable: false });
    } else {
      this.setState({ loading: false, quotes: [], unavailable: true });
    }
    this.scheduleRetry();
  }

  scheduleRetry() {
    if (this.timer == null || this.retryTimer != null) return;
    const delay = MARKET_INDICES_RETRY_DELAYS_MS[this.retryAttempt];
    if (delay == null) return;
    this.retryAttempt += 1;
    this.retryTimer = globalThis.setTimeout(() => {
      this.retryTimer = null;
      void this.refresh();
    }, delay);
  }

  clearRetry() {
    if (this.retryTimer == null) return;
    globalThis.clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  start() {
    if (this.timer != null) return Promise.resolve();
    this.timer = globalThis.setInterval(() => void this.refresh(), this.pollMs);
    return this.refresh();
  }

  stop() {
    this.clearRetry();
    this.retryAttempt = 0;
    if (this.timer == null) return;
    globalThis.clearInterval(this.timer);
    this.timer = null;
  }

  setState(nextState) {
    this.state = nextState;
    for (const listener of this.listeners) listener(nextState);
  }
}

export const marketIndicesStore = new MarketIndicesStore();

export function useMarketIndices({ store } = {}) {
  const transport = useRuntimeTransport();
  const resolvedStore = useMemo(
    () =>
      store ??
      (transport === loopbackRuntimeTransport
        ? marketIndicesStore
        : new MarketIndicesStore({ transport })),
    [store, transport],
  );
  const [state, setState] = useState(() => resolvedStore.getState());

  useEffect(() => {
    setState(resolvedStore.getState());
    const unsubscribe = resolvedStore.subscribe(setState);
    void resolvedStore.start();
    return () => {
      unsubscribe();
      resolvedStore.stop();
    };
  }, [resolvedStore]);

  return state;
}
