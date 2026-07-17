import { Value } from "@sinclair/typebox/value";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { formatAsOfLine } from "../../../src/infra/freshness.js";
import { TOOL_BUNDLE_TOOLS } from "../../../src/routing/route-manifest.js";
import { getAllTools } from "../../../src/tools/index.js";
import { priceComparisonTool } from "../../../src/tools/market/price-comparison.js";
import alphaVantageHistoryFixture from "../../fixtures/alphavantage/AAPL-time-series-daily.json";
import aaplHistoryFixture from "../../fixtures/yahoo/AAPL-history.json";
import msftHistoryFixture from "../../fixtures/yahoo/MSFT-history.json";

const configMock = vi.hoisted(() => ({
  alphaVantageApiKey: undefined as string | undefined,
}));

vi.mock("../../../src/config.js", () => ({
  getConfig: () => ({ alphaVantageApiKey: configMock.alphaVantageApiKey }),
}));

describe("get_price_comparison tool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    configMock.alphaVantageApiKey = undefined;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("aligns two symbols to common dates and indexes each series to 100", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      return {
        ok: true,
        json: () => Promise.resolve(url.includes("MSFT") ? msftHistoryFixture : aaplHistoryFixture),
      } as Response;
    });

    const result = await priceComparisonTool.execute("call-1", {
      symbols: ["AAPL", "MSFT"],
      range: "1y",
    });

    expect(result.details.series).toHaveLength(2);
    const [aapl, msft] = result.details.series;
    expect(aapl?.bars.map((bar) => bar.date)).toEqual(msft?.bars.map((bar) => bar.date));
    expect(aapl?.bars.map((bar) => bar.date)).toEqual([
      "2024-03-28",
      "2024-03-29",
      "2024-03-30",
      "2024-03-31",
    ]);
    expect(result.details.baseDate).toBe("2024-03-28");
    for (const series of result.details.series) {
      expect(series.indexed[0]).toBe(100);
      expect(series.indexed).toEqual(
        series.bars.map((bar) => (bar.close / series.bars[0]!.close) * 100),
      );
    }
  });

  it("bounds symbol count and accepts only supported history ranges", () => {
    expect(Value.Check(priceComparisonTool.parameters, { symbols: ["AAPL"], range: "1y" })).toBe(
      false,
    );
    expect(
      Value.Check(priceComparisonTool.parameters, {
        symbols: ["A", "B", "C", "D", "E", "F", "G"],
        range: "1y",
      }),
    ).toBe(false);
    expect(
      Value.Check(priceComparisonTool.parameters, { symbols: ["AAPL", "MSFT"], range: "1w" }),
    ).toBe(false);
    expect(
      Value.Check(priceComparisonTool.parameters, { symbols: ["AAPL", "MSFT"], range: "1y" }),
    ).toBe(true);
  });

  it("falls back per symbol without affecting another successful symbol", async () => {
    configMock.alphaVantageApiKey = "test-key";
    const overlappingYahooFixture = yahooHistoryFixture("AAPL", [
      Date.UTC(2026, 3, 1) / 1_000,
      Date.UTC(2026, 3, 2) / 1_000,
      Date.UTC(2026, 3, 3) / 1_000,
    ]);
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("query1.finance.yahoo.com") && url.includes("MSFT")) {
        return new Response("missing", { status: 404, statusText: "Not Found" });
      }
      return new Response(
        JSON.stringify(
          url.includes("alphavantage") ? alphaVantageHistoryFixture : overlappingYahooFixture,
        ),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await priceComparisonTool.execute("call-fallback", {
      symbols: ["AAPL", "MSFT"],
      range: "1y",
      interval: "1d",
    });

    expect(result.details.series.map((series) => series.symbol)).toEqual(["AAPL", "MSFT"]);
    expect(result.details.series.every((series) => series.bars.length === 3)).toBe(true);
    expect(result.details.series[1]?.bars.at(-1)?.close).toBe(186.35);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("function=TIME_SERIES_DAILY"),
      expect.anything(),
    );
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("chart/AAPL"),
      expect.anything(),
    );
  });

  it("continues with two series and reports one unavailable symbol", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("MISSING")) {
        return new Response("missing", { status: 404, statusText: "Not Found" });
      }
      return new Response(
        JSON.stringify(url.includes("MSFT") ? msftHistoryFixture : aaplHistoryFixture),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const result = await priceComparisonTool.execute("call-partial", {
      symbols: ["AAPL", "MISSING", "MSFT"],
      range: "1y",
    });
    const text = result.content[0];
    if (text.type !== "text") throw new Error("expected text content");

    expect(result.details.series.map((series) => series.symbol)).toEqual(["AAPL", "MSFT"]);
    expect(result.details.unavailableSymbols).toEqual(["MISSING"]);
    expect(text.text).toContain("MISSING");
    expect(text.text).toMatch(/unavailable/i);
  });

  it("returns explicit unavailability text and no series when fewer than two survive", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      if (!url.includes("AAPL")) {
        return new Response("missing", { status: 404, statusText: "Not Found" });
      }
      return new Response(JSON.stringify(aaplHistoryFixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await priceComparisonTool.execute("call-insufficient", {
      symbols: ["AAPL", "MISSING", "ABSENT"],
      range: "1y",
    });
    const text = result.content[0];
    if (text.type !== "text") throw new Error("expected text content");

    expect(result.details.series).toEqual([]);
    expect(result.details.unavailableSymbols).toEqual(["MISSING", "ABSENT"]);
    expect(text.text).toMatch(/price comparison unavailable/i);
    expect(text.text).toContain("MISSING, ABSENT");
  });

  it("notes only intersection losses above 30 percent and names the affected symbol", async () => {
    const heavyHistoryFixture = yahooHistoryFixture(
      "HEAVY",
      [1711555200, 1711641600, 1711728000, 1711814400, 1711900800, 1711987200, 1712073600],
    );
    globalThis.fetch = vi.fn(async (input) => {
      const url = String(input);
      const fixture = url.includes("HEAVY")
        ? heavyHistoryFixture
        : url.includes("MSFT")
          ? msftHistoryFixture
          : aaplHistoryFixture;
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const heavyResult = await priceComparisonTool.execute("call-heavy-loss", {
      symbols: ["AAPL", "HEAVY"],
      range: "1y",
    });
    const heavyText = textContent(heavyResult.content[0]);
    expect(heavyText).toMatch(/reduced aligned window/i);
    expect(heavyText).toContain("HEAVY");

    const belowResult = await priceComparisonTool.execute("call-below-loss", {
      symbols: ["AAPL", "MSFT"],
      range: "1y",
    });
    expect(textContent(belowResult.content[0])).not.toMatch(/reduced aligned window/i);
  });

  it("formats one numeric table row per series and ends with aligned-date freshness", async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const fixture = String(input).includes("MSFT") ? msftHistoryFixture : aaplHistoryFixture;
      return new Response(JSON.stringify(fixture), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const result = await priceComparisonTool.execute("call-content", {
      symbols: ["AAPL", "MSFT"],
      range: "1y",
    });
    const lines = textContent(result.content[0]).split("\n");
    const tableRows = lines.filter((line) => line.includes(" | "));

    expect(tableRows).toEqual([
      `AAPL | 172.28 | 178.72 | ${((178.72 / 172.28) * 100 - 100).toFixed(2)}%`,
      `MSFT | 419.83 | 421.90 | ${((421.9 / 419.83) * 100 - 100).toFixed(2)}%`,
    ]);
    expect(lines.at(-1)).toBe(formatAsOfLine(result.details.freshness));
    expect(result.details.freshness.providerDataDate).toBe("2024-03-31");
  });

  it("is registered and allowed by the core market bundle", () => {
    expect(getAllTools().map((tool) => tool.name)).toContain("get_price_comparison");
    expect(TOOL_BUNDLE_TOOLS.core_market).toContain("get_price_comparison");
  });
});

function textContent(content: { type: string; text?: string }): string {
  if (content.type !== "text" || content.text === undefined) {
    throw new Error("expected text content");
  }
  return content.text;
}

function yahooHistoryFixture(symbol: string, timestamps: number[]) {
  const values = timestamps.map((_, index) => 100 + index);
  return {
    chart: {
      result: [
        {
          meta: { symbol },
          timestamp: timestamps,
          indicators: {
            quote: [
              {
                open: values,
                high: values.map((value) => value + 2),
                low: values.map((value) => value - 2),
                close: values.map((value) => value + 1),
                volume: values.map((value) => value * 1_000),
              },
            ],
          },
        },
      ],
    },
  };
}
