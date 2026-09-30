// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMarketStateStore,
  MARKET_STATE_POLL_MS,
  MarketStateStore,
  useMarketState,
} from "../../../gui/web/src/hooks/useMarketState.jsx";
import { RuntimeTransportProvider } from "../../../gui/web/src/runtime/runtime-transport-provider.jsx";

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Each getMarketState call parks on a deferred the test settles, so a test can
// hold a request in flight across poll ticks.
function controlledTransport() {
  const pending: Deferred<Record<string, unknown>>[] = [];
  const transport = {
    getMarketState: vi.fn(() => {
      const next = deferred<Record<string, unknown>>();
      pending.push(next);
      return next.promise;
    }),
    getMarketQuotes: vi.fn(async () => ({ watchlistQuotes: [] })),
  };
  return {
    transport,
    pending,
    async settleAll(data: Record<string, unknown> = { watchlist: [] }) {
      while (pending.length) pending.shift()?.resolve(data);
      await flush();
    },
  };
}

function fakeDocument(hidden = false) {
  return Object.assign(new EventTarget(), { hidden });
}

function setHidden(doc: ReturnType<typeof fakeDocument>, hidden: boolean) {
  doc.hidden = hidden;
  doc.dispatchEvent(new Event("visibilitychange"));
}

async function flush() {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
}

describe("MarketStateStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the idle poll at four seconds while visible", () => {
    expect(MARKET_STATE_POLL_MS).toBe(4000);
  });

  it("shares one poller and one initial fetch across subscribers", async () => {
    const { transport, settleAll } = controlledTransport();
    const store = new MarketStateStore({ transport, document: fakeDocument() });
    const stopA = store.subscribe(() => {});
    const stopB = store.subscribe(() => {});
    expect(transport.getMarketState).toHaveBeenCalledTimes(1);
    await settleAll();

    await vi.advanceTimersByTimeAsync(MARKET_STATE_POLL_MS);
    expect(transport.getMarketState).toHaveBeenCalledTimes(2);
    await settleAll();
    stopA();
    stopB();
  });

  it("publishes merged state, loading and error to subscribers", async () => {
    const { transport, pending, settleAll } = controlledTransport();
    const store = new MarketStateStore({ transport, document: fakeDocument() });
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    expect(store.getSnapshot().loading).toBe(true);

    await settleAll({ watchlist: [{ id: 1, symbol: "AAPL" }] });
    expect(store.getSnapshot().loading).toBe(false);
    expect(store.getSnapshot().state.watchlist).toEqual([{ id: 1, symbol: "AAPL" }]);
    expect(store.getSnapshot().state.loaded).toBe(true);
    expect(listener).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(MARKET_STATE_POLL_MS);
    pending.shift()?.reject(new Error("SQLite busy"));
    await flush();
    expect(store.getSnapshot().error).toBe("SQLite busy");
    stop();
  });

  it("skips poll ticks while a request is still in flight (#222)", async () => {
    const { transport, settleAll } = controlledTransport();
    const store = new MarketStateStore({ transport, document: fakeDocument() });
    const stop = store.subscribe(() => {});
    expect(transport.getMarketState).toHaveBeenCalledTimes(1);

    // A slow server: three intervals pass while the first request is pending.
    await vi.advanceTimersByTimeAsync(MARKET_STATE_POLL_MS * 3);
    expect(transport.getMarketState).toHaveBeenCalledTimes(1);

    await settleAll();
    await vi.advanceTimersByTimeAsync(MARKET_STATE_POLL_MS);
    expect(transport.getMarketState).toHaveBeenCalledTimes(2);
    await settleAll();
    stop();
  });

  it("keeps polling after a transport that throws synchronously", async () => {
    const transport = {
      getMarketState: vi.fn(() => {
        throw new Error("transport closed");
      }),
      getMarketQuotes: vi.fn(async () => ({})),
    };
    const store = new MarketStateStore({ transport, document: fakeDocument() });
    const stop = store.subscribe(() => {});
    await flush();
    expect(store.getSnapshot().error).toBe("transport closed");
    expect(store.getSnapshot().loading).toBe(false);

    await vi.advanceTimersByTimeAsync(MARKET_STATE_POLL_MS);
    expect(transport.getMarketState).toHaveBeenCalledTimes(2);
    stop();
  });

  it("follows an explicit refresh during a poll with one fresh read", async () => {
    // A mutation's refresh must observe its own write, so it cannot reuse a
    // read that started before the write landed.
    const { transport, pending, settleAll } = controlledTransport();
    const store = new MarketStateStore({ transport, document: fakeDocument() });
    const stop = store.subscribe(() => {});
    const first = store.refresh();
    const second = store.refresh();
    expect(transport.getMarketState).toHaveBeenCalledTimes(1);

    pending.shift()?.resolve({ watchlist: [] });
    await flush();
    expect(transport.getMarketState).toHaveBeenCalledTimes(2);
    pending.shift()?.resolve({ watchlist: [{ id: 2, symbol: "NVDA" }] });
    await Promise.all([first, second]);
    expect(store.getSnapshot().state.watchlist).toEqual([{ id: 2, symbol: "NVDA" }]);
    await settleAll();
    stop();
  });

  it("pauses while the document is hidden and refreshes once on return (#222)", async () => {
    const doc = fakeDocument();
    const { transport, settleAll } = controlledTransport();
    const store = new MarketStateStore({ transport, document: doc });
    const stop = store.subscribe(() => {});
    await settleAll();
    expect(transport.getMarketState).toHaveBeenCalledTimes(1);

    setHidden(doc, true);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.getMarketState).toHaveBeenCalledTimes(1);

    setHidden(doc, false);
    expect(transport.getMarketState).toHaveBeenCalledTimes(2);
    await settleAll();

    await vi.advanceTimersByTimeAsync(MARKET_STATE_POLL_MS);
    expect(transport.getMarketState).toHaveBeenCalledTimes(3);
    await settleAll();
    stop();
  });

  it("does not fetch at all when subscribed from a hidden tab", async () => {
    const doc = fakeDocument(true);
    const { transport, settleAll } = controlledTransport();
    const store = new MarketStateStore({ transport, document: doc });
    const stop = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transport.getMarketState).not.toHaveBeenCalled();

    setHidden(doc, false);
    expect(transport.getMarketState).toHaveBeenCalledTimes(1);
    await settleAll();
    stop();
  });

  it("does not refetch when a page remounts within the poll window (#222)", async () => {
    const { transport, settleAll } = controlledTransport();
    const store = new MarketStateStore({ transport, document: fakeDocument() });
    const stop = store.subscribe(() => {});
    await settleAll();
    stop();

    await vi.advanceTimersByTimeAsync(MARKET_STATE_POLL_MS / 2);
    const again = store.subscribe(() => {});
    expect(transport.getMarketState).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().loading).toBe(false);

    await vi.advanceTimersByTimeAsync(MARKET_STATE_POLL_MS);
    expect(transport.getMarketState).toHaveBeenCalledTimes(2);
    await settleAll();
    again();
  });

  it("refetches immediately when a page returns after the data went stale", async () => {
    const { transport, settleAll } = controlledTransport();
    const store = new MarketStateStore({ transport, document: fakeDocument() });
    store.subscribe(() => {})();
    await settleAll();

    await vi.advanceTimersByTimeAsync(MARKET_STATE_POLL_MS * 2);
    expect(transport.getMarketState).toHaveBeenCalledTimes(1);
    const stop = store.subscribe(() => {});
    expect(transport.getMarketState).toHaveBeenCalledTimes(2);
    await settleAll();
    stop();
  });

  it("stops polling and listening once the last subscriber leaves", async () => {
    const doc = fakeDocument();
    const { transport, settleAll } = controlledTransport();
    const store = new MarketStateStore({ transport, document: doc });
    const stop = store.subscribe(() => {});
    await settleAll();
    stop();

    await vi.advanceTimersByTimeAsync(60_000);
    setHidden(doc, true);
    setHidden(doc, false);
    expect(transport.getMarketState).toHaveBeenCalledTimes(1);
  });

  it("refreshes quotes on a shared five-minute cadence while subscribed", async () => {
    const { transport, settleAll } = controlledTransport();
    const store = new MarketStateStore({
      transport,
      document: fakeDocument(),
      quotePollMs: 60_000,
    });
    const stopA = store.subscribe(() => {});
    const stopB = store.subscribe(() => {});
    await settleAll();
    expect(transport.getMarketQuotes).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    expect(transport.getMarketQuotes).toHaveBeenCalledTimes(1);
    await settleAll();
    stopA();
    stopB();
  });

  it("keeps one store per transport", () => {
    const { transport } = controlledTransport();
    expect(getMarketStateStore(transport)).toBe(getMarketStateStore(transport));
    expect(getMarketStateStore(controlledTransport().transport)).not.toBe(
      getMarketStateStore(transport),
    );
  });
});

describe("useMarketState", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("serves every mounted consumer from one market-state request", async () => {
    const { transport, settleAll } = controlledTransport();
    const seen: unknown[] = [];
    function Consumer() {
      const { state } = useMarketState();
      seen.push(state.watchlist);
      return null;
    }
    await act(async () => {
      root.render(
        React.createElement(
          RuntimeTransportProvider,
          { transport },
          React.createElement(Consumer),
          React.createElement(Consumer),
          React.createElement(Consumer),
        ),
      );
    });
    await act(async () => settleAll({ watchlist: [{ id: 1, symbol: "AAPL" }] }));

    expect(transport.getMarketState).toHaveBeenCalledTimes(1);
    expect(seen.at(-1)).toEqual([{ id: 1, symbol: "AAPL" }]);
  });
});
