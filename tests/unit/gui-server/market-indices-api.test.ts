import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildMarketIndicesSnapshot } from "../../../gui/server/market-indices-api.js";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import fixture from "../../fixtures/yahoo/market-indices-chart.json";

const yahooFinanceMock = vi.hoisted(() => ({ quote: vi.fn() }));

vi.mock("yahoo-finance2", () => ({
  default: vi.fn(function YahooFinance() {
    return { quote: yahooFinanceMock.quote };
  }),
}));

const originalFetch = globalThis.fetch;

describe("market indices snapshot", () => {
  beforeEach(() => {
    cache.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T14:10:00.000Z"));
    rateLimiter.configure("yahoo", 1000, 1000);
    yahooFinanceMock.quote.mockImplementation(async (symbol: string) => ({
      marketState: symbol === "BTC-USD" ? "REGULAR" : "POST",
    }));
    globalThis.fetch = vi.fn(async (input) => {
      const url = new URL(String(input));
      const symbol = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
      const quote = fixture.quotes[symbol as keyof typeof fixture.quotes];
      return {
        ok: true,
        json: async () => yahooChartResponse(quote, [quote.regularMarketPrice]),
      } as Response;
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
    cache.clear();
  });

  it("returns the fixed symbols in order with their Ticker Line asset types", async () => {
    const snapshot = await buildMarketIndicesSnapshot();

    expect(snapshot.generatedAt).toBe("2026-07-16T14:10:00.000Z");
    expect(snapshot.indices.map((index) => index.symbol)).toEqual([
      "^GSPC",
      "^NDX",
      "^DJI",
      "BTC-USD",
    ]);
    expect(snapshot.indices).toHaveLength(4);
    expect(snapshot.indices[0]).toMatchObject({
      symbol: "^GSPC",
      assetType: "index",
      name: "S&P 500",
      status: "ok",
      price: 6310.12,
      currency: null,
      marketState: "POST",
    });
    expect(snapshot.indices[0].change).toBeCloseTo(11.62, 2);
    expect(snapshot.indices.every((index) => index.status === "ok")).toBe(true);
  });

  it("isolates a provider failure to its symbol", async () => {
    const successfulFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = new URL(String(input));
      if (decodeURIComponent(url.pathname).endsWith("/^NDX")) {
        return {
          ok: false,
          status: 404,
          statusText: "Not Found",
          headers: { get: () => null },
          text: async () => "missing",
        } as unknown as Response;
      }
      return successfulFetch(input, init);
    });

    const snapshot = await buildMarketIndicesSnapshot();

    expect(snapshot.indices[1]).toMatchObject({
      symbol: "^NDX",
      assetType: "index",
      status: "unavailable",
      reason: "HTTP 404 Not Found",
    });
    expect(snapshot.indices.filter((index) => index.status === "ok")).toHaveLength(3);
  });
});

function yahooChartResponse(
  meta: (typeof fixture.quotes)[keyof typeof fixture.quotes],
  closes: number[],
) {
  const timestamps = closes.map((_, index) => 1784210400 + index * 300);
  return {
    chart: {
      result: [
        {
          meta,
          timestamp: timestamps,
          indicators: {
            quote: [
              {
                open: closes,
                high: closes,
                low: closes,
                close: closes,
                volume: closes.map(() => meta.regularMarketVolume),
              },
            ],
          },
        },
      ],
    },
  };
}
