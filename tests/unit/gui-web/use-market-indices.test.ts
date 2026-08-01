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
});
