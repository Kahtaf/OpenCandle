// @vitest-environment jsdom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSymbolData } from "../../../gui/web/src/features/symbol/use-symbol-data.js";
import { RuntimeTransportContext } from "../../../gui/web/src/runtime/runtime-transport-context.js";

const DAY_SECONDS = 86_400;
const LAST_BAR_SECONDS = Math.floor(Date.UTC(2026, 7, 5) / 1000);

interface SymbolData {
  symbol: string;
  descriptor: { type: string; stats: string[] };
  viewModel: {
    trend: { sentence: string | null; rows: unknown[] };
    keyLevels: Array<{ key: string }>;
    horizonReturns: unknown[];
    historyStale: boolean;
    historyAsOf: string | null;
  };
  quote: Record<string, unknown> | null;
  overview: Record<string, unknown> | null;
  history: Record<string, unknown> | null;
  positionRows: unknown[];
  alertRows: unknown[];
  memberships: unknown[];
  error: string;
  refresh: unknown;
  refreshQuotes: unknown;
}

function dailyBars(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const close = 100 + index;
    return {
      time: LAST_BAR_SECONDS - (count - 1 - index) * DAY_SECONDS,
      open: close,
      high: close,
      low: close,
      close,
      volume: 1_000_000,
    };
  });
}

let latest: SymbolData | undefined;
let root: Root;
let container: HTMLDivElement;

function Probe({ symbol }: { symbol: string }) {
  latest = useSymbolData(symbol) as unknown as SymbolData;
  return null;
}

function stubTransport(overrides: Record<string, unknown> = {}) {
  return {
    getMarketState: vi.fn(async () => ({ instruments: [], watchlists: [] })),
    getMarketQuotes: vi.fn(async () => ({})),
    getInstrumentQuote: vi.fn(async (symbol: string) => ({
      symbol,
      status: "ok",
      price: 300,
      currency: "USD",
      volume: 12_400_000,
      high: 305,
      low: 295,
    })),
    getInstrumentEndpoint: vi.fn(async (_endpoint: string, symbol: string) => ({
      symbol,
      status: "unavailable",
      reason: "no company fundamentals returned",
    })),
    getInstrumentHistory: vi.fn(async (symbol: string, range: string) => ({
      status: "ok",
      symbol,
      range,
      bars: dailyBars(400),
    })),
    searchInstruments: vi.fn(async (query: string) => ({
      query,
      candidates: [{ symbol: query.toUpperCase(), quoteType: "CURRENCY", assetType: "equity" }],
    })),
    ...overrides,
  };
}

async function render(symbol: string, transport: Record<string, unknown>) {
  await act(async () =>
    root.render(
      React.createElement(
        RuntimeTransportContext.Provider,
        { value: transport },
        React.createElement(Probe, { symbol }),
      ),
    ),
  );
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  latest = undefined;
  vi.restoreAllMocks();
});

describe("useSymbolData derived view model", () => {
  it("exposes the descriptor and derived stats alongside the existing fields", async () => {
    const transport = stubTransport();
    await render("EURUSD=X", transport);

    expect(transport.getInstrumentHistory).toHaveBeenCalledWith("EURUSD=X", "1Y");
    expect(latest?.descriptor.type).toBe("fx");
    expect(latest?.descriptor.stats).not.toContain("volume");
    expect(latest?.viewModel.trend.sentence).toBe(
      "Price is below its 20, 50 and 200 day averages.",
    );
    expect(latest?.viewModel.keyLevels.map((level) => level.key)).toEqual([
      "week52High",
      "week52Low",
      "sma20",
      "sma50",
    ]);
    expect(latest?.viewModel.horizonReturns).toHaveLength(5);

    // The fields the page already renders keep their existing meaning.
    expect(latest?.symbol).toBe("EURUSD=X");
    expect(latest?.quote).toMatchObject({ status: "ok", price: 300 });
    expect(latest?.overview).toMatchObject({ status: "unavailable" });
    expect(latest?.history).toMatchObject({ status: "ok" });
    expect(latest?.positionRows).toEqual([]);
    expect(latest?.alertRows).toEqual([]);
    expect(latest?.memberships).toEqual([]);
    expect(typeof latest?.refresh).toBe("function");
    expect(typeof latest?.refreshQuotes).toBe("function");
  });

  it("degrades to the unknown descriptor when instrument search is unavailable", async () => {
    const transport = stubTransport({
      searchInstruments: vi.fn(async () => {
        throw new Error("relay unavailable");
      }),
    });
    await render("ZZZZ", transport);

    expect(latest?.descriptor.type).toBe("unknown");
    expect(latest?.error).toBeFalsy();
    expect(latest?.viewModel.keyLevels).toHaveLength(4);
  });

  it("carries the derived history's staleness into the view model", async () => {
    const transport = stubTransport({
      getInstrumentHistory: vi.fn(async (symbol: string, range: string) => ({
        status: "ok",
        symbol,
        range,
        stale: true,
        dataAsOf: "2026-08-01",
        bars: dailyBars(400),
      })),
    });
    await render("AAPL", transport);

    expect(latest?.viewModel.historyStale).toBe(true);
    expect(latest?.viewModel.historyAsOf).toBe("2026-08-01");
  });

  it("still derives stats when the runtime has no instrument search at all", async () => {
    const transport = stubTransport({ searchInstruments: undefined });
    await render("AAPL", transport);

    expect(latest?.descriptor.type).toBe("unknown");
    expect(latest?.viewModel.trend.rows).toHaveLength(3);
  });
});
