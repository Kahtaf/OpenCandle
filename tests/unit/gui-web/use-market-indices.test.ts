import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarketIndicesStore } from "../../../gui/web/src/hooks/useMarketIndices.jsx";
import { QUOTE_REFRESH_INTERVAL_MS } from "../../../gui/web/src/hooks/useMarketState.jsx";

const originalFetch = globalThis.fetch;

describe("MarketIndicesStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("loads available quotes and polls at the quote refresh cadence", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        generatedAt: "2026-07-16T14:10:00.000Z",
        indices: [
          { symbol: "^GSPC", status: "ok", price: 6310.12 },
          { symbol: "^NDX", status: "unavailable", reason: "missing" },
        ],
      }),
    });
    const store = new MarketIndicesStore();

    await store.start();

    expect(store.getState()).toEqual({
      loading: false,
      quotes: [{ symbol: "^GSPC", status: "ok", price: 6310.12 }],
      unavailable: false,
    });
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/market-state/indices");

    await vi.advanceTimersByTimeAsync(QUOTE_REFRESH_INTERVAL_MS);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    store.stop();
  });

  it.each([
    {
      name: "the endpoint fails",
      response: { ok: false, statusText: "Service Unavailable" },
    },
    {
      name: "the endpoint has zero available symbols",
      response: {
        ok: true,
        json: async () => ({
          indices: [{ symbol: "^GSPC", status: "unavailable", reason: "missing" }],
        }),
      },
    },
  ])("exposes the hide-strip state when $name", async ({ response }) => {
    globalThis.fetch = vi.fn().mockResolvedValue(response);
    const store = new MarketIndicesStore();

    await store.refresh();

    expect(store.getState()).toEqual({ loading: false, quotes: [], unavailable: true });
  });

  it("recovers from a first-load failure within the retry backoff instead of waiting for the poll", async () => {
    const getMarketIndices = vi
      .fn()
      .mockRejectedValueOnce(new Error("The hosted writer changed before the action completed."))
      .mockResolvedValue({ indices: [{ symbol: "^GSPC", status: "ok", price: 6310.12 }] });
    const store = new MarketIndicesStore({ transport: { getMarketIndices } as never });

    await store.start();
    expect(store.getState()).toEqual({ loading: false, quotes: [], unavailable: true });

    await vi.advanceTimersByTimeAsync(2_000);

    expect(getMarketIndices).toHaveBeenCalledTimes(2);
    expect(store.getState()).toEqual({
      loading: false,
      quotes: [{ symbol: "^GSPC", status: "ok", price: 6310.12 }],
      unavailable: false,
    });
    store.stop();
  });

  it("backs off between retries and stops retrying once stopped", async () => {
    const getMarketIndices = vi.fn().mockRejectedValue(new Error("offline"));
    const store = new MarketIndicesStore({ transport: { getMarketIndices } as never });

    await store.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(getMarketIndices).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(getMarketIndices).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(getMarketIndices).toHaveBeenCalledTimes(3);

    store.stop();
    await vi.advanceTimersByTimeAsync(QUOTE_REFRESH_INTERVAL_MS);
    expect(getMarketIndices).toHaveBeenCalledTimes(3);
  });

  it.each([
    { name: "a request failure", next: () => Promise.reject(new Error("offline")) },
    {
      name: "a response with zero available symbols",
      next: () =>
        Promise.resolve({
          indices: [{ symbol: "^GSPC", status: "unavailable", reason: "missing" }],
        }),
    },
  ])("keeps the last good quotes after $name", async ({ next }) => {
    const good = { symbol: "^GSPC", status: "ok", price: 6310.12 };
    const getMarketIndices = vi
      .fn()
      .mockResolvedValueOnce({ indices: [good] })
      .mockImplementationOnce(next)
      .mockResolvedValue({ indices: [{ ...good, price: 6320 }] });
    const store = new MarketIndicesStore({ transport: { getMarketIndices } as never });

    await store.start();
    await vi.advanceTimersByTimeAsync(QUOTE_REFRESH_INTERVAL_MS);

    expect(getMarketIndices).toHaveBeenCalledTimes(2);
    expect(store.getState()).toEqual({ loading: false, quotes: [good], unavailable: false });

    await vi.advanceTimersByTimeAsync(2_000);
    expect(store.getState().quotes).toEqual([{ ...good, price: 6320 }]);
    store.stop();
  });
});
