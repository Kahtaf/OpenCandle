import { useEffect, useState } from "react";
import { QUOTE_REFRESH_INTERVAL_MS } from "./useMarketState.jsx";

const INITIAL_STATE = { loading: true, quotes: [], unavailable: false };

export class MarketIndicesStore {
  constructor({ pollMs = QUOTE_REFRESH_INTERVAL_MS } = {}) {
    this.pollMs = pollMs;
    this.state = INITIAL_STATE;
    this.listeners = new Set();
    this.timer = null;
  }

  getState() {
    return this.state;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async refresh() {
    try {
      const response = await fetch("/api/market-state/indices");
      if (!response.ok) throw new Error(response.statusText || "Failed to load market indices");
      const snapshot = await response.json();
      const quotes = (snapshot.indices ?? []).filter((quote) => quote?.status === "ok");
      this.setState({ loading: false, quotes, unavailable: quotes.length === 0 });
    } catch {
      this.setState({ loading: false, quotes: [], unavailable: true });
    }
  }

  start() {
    if (this.timer != null) return Promise.resolve();
    const initialRefresh = this.refresh();
    this.timer = globalThis.setInterval(() => void this.refresh(), this.pollMs);
    return initialRefresh;
  }

  stop() {
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

export function useMarketIndices({ store = marketIndicesStore } = {}) {
  const [state, setState] = useState(() => store.getState());

  useEffect(() => {
    const unsubscribe = store.subscribe(setState);
    void store.start();
    return () => {
      unsubscribe();
      store.stop();
    };
  }, [store]);

  return state;
}
