import { useEffect, useMemo, useState } from "react";
import { loopbackRuntimeTransport } from "../runtime/runtime-transport.js";
import { useRuntimeTransport } from "../runtime/runtime-transport-context.js";
import { QUOTE_REFRESH_INTERVAL_MS } from "./useMarketState.jsx";

const INITIAL_STATE = { loading: true, quotes: [], unavailable: false };

export class MarketIndicesStore {
  constructor({ pollMs = QUOTE_REFRESH_INTERVAL_MS, transport = loopbackRuntimeTransport } = {}) {
    this.pollMs = pollMs;
    this.transport = transport;
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
      const snapshot = await this.transport.getMarketIndices();
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
