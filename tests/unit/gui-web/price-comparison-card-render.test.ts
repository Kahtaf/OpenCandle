import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PriceComparisonCard } from "../../../gui/web/src/features/renderers/cards/price-comparison.jsx";
import { formatRawClose } from "../../../gui/web/src/features/renderers/cards/price-comparison-format.js";
import { ToolResultCard } from "../../../gui/web/src/features/renderers/ToolResultCard.jsx";
import { SERIES_COLORS } from "../../../gui/web/src/lib/series-colors.js";

const dates = ["2026-07-14", "2026-07-15"];
const makeSeries = (symbol: string, closes: [number, number], indexed: [number, number]) => ({
  symbol,
  bars: dates.map((date, index) => ({
    date,
    open: closes[index] - 1,
    high: closes[index] + 2,
    low: closes[index] - 2,
    close: closes[index],
    volume: 10_000 + index * 1_000,
  })),
  indexed,
});

const details = {
  range: "1y",
  interval: "1d",
  baseDate: "2026-07-14",
  series: [
    makeSeries("AAPL", [190, 200], [100, 105.3]),
    makeSeries("MSFT", [420, 410], [100, 97.6]),
  ],
  unavailableSymbols: [] as string[],
  freshness: {
    fetchedAt: "2026-07-16T12:00:00.000Z",
    providerDataDate: "2026-07-15",
    cacheStatus: "live",
    marketSession: "after_close",
    isStaleForSession: false,
  },
};

async function renderComparison(value: typeof details | { value: typeof details } = details) {
  const element = React.createElement(PriceComparisonCard, {
    message: { toolName: "get_price_comparison", details: value },
    header: React.createElement("div", null, "Price comparison"),
    text: "comparison output",
  });
  renderToStaticMarkup(element);
  await import("../../../gui/web/src/components/market-chart.jsx");
  await Promise.resolve();
  return renderToStaticMarkup(element);
}

describe("PriceComparisonCard", () => {
  it("renders indexed series with a symbol legend and indexing-basis subtitle", async () => {
    const html = await renderComparison();

    expect(html).toContain('data-slot="market-chart"');
    expect(html).toContain('data-slot="market-chart-legend"');
    expect(html).toContain("AAPL");
    expect(html).toContain("MSFT");
    expect(html).toContain("% change, indexed to 100 at 2026-07-14");
  });

  it("keeps positional legend and end-label colors when a requested symbol is unavailable", async () => {
    const html = await renderComparison({ ...details, unavailableSymbols: ["GOOG"] });

    expect(html).toContain(`background-color:${SERIES_COLORS[0]}`);
    expect(html).toContain(`background-color:${SERIES_COLORS[1]}`);
    expect(html).toMatch(/data-symbol="AAPL"[\s\S]*?background-color:[^;"]+/);
    expect(html).toMatch(/data-symbol="MSFT"[\s\S]*?background-color:[^;"]+/);
  });

  it("renders direct end-of-line symbol labels for four or fewer series", async () => {
    const html = await renderComparison();

    expect(html.match(/data-slot="comparison-end-label"/g)).toHaveLength(2);
    expect(html).toMatch(/data-slot="comparison-end-label"[^>]*>[\s\S]*?AAPL/);
    expect(html).toMatch(/data-slot="comparison-end-label"[^>]*>[\s\S]*?MSFT/);
  });

  it("warns about every unavailable symbol", async () => {
    const html = await renderComparison({
      ...details,
      unavailableSymbols: ["GOOG", "META"],
    });

    expect(html).toContain("Unavailable: GOOG, META");
  });

  it("labels, bounds, and contains the chart without range controls", async () => {
    const html = await renderComparison();

    expect(html).toContain('aria-label="Indexed price comparison of AAPL, MSFT over 1y"');
    expect(html).toContain("h-[180px] overflow-hidden sm:h-[220px]");
    expect(html).toContain("1y");
    expect(html).toContain("As of 2026-07-15");
    expect(html).not.toContain('data-slot="market-chart-range-selector"');
  });

  it("uses tabular numerals and no currency symbols in legend, subtitle, or end labels", async () => {
    const html = await renderComparison();
    const subtitle = html.match(/data-slot="comparison-subtitle"[^>]*>(.*?)<\/div>/)?.[1] ?? "";
    const legend =
      html.match(/data-slot="market-chart-legend"[^>]*>([\s\S]*?)<\/div><\/div>/)?.[1] ?? "";
    const endLabels = [...html.matchAll(/data-slot="comparison-end-label"[^>]*>([\s\S]*?)<\/div>/g)]
      .map((match) => match[1])
      .join(" ");

    expect(html).toContain("tabular-nums");
    expect(`${subtitle}${legend}${endLabels}`).not.toContain("$");
  });

  it("formats raw comparison closes without assuming US dollars", () => {
    expect(formatRawClose(123.456)).toBe("123.46");
  });

  it("reads details through the details.value wrapper", async () => {
    const html = await renderComparison({ value: details });

    expect(html).toContain("Indexed price comparison of AAPL, MSFT over 1y");
    expect(html).toContain("indexed to 100 at 2026-07-14");
  });

  it("keeps compare_companies registered to the fundamentals CompareCard", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolResultCard, {
        message: {
          toolName: "compare_companies",
          content: "comparison",
          details: {
            quotes: [
              { symbol: "AAPL", price: 200, change: 10, changePercent: 5.26 },
              { symbol: "MSFT", price: 410, change: -10, changePercent: -2.38 },
            ],
          },
        },
      }),
    );

    expect(html).toContain("AAPL");
    expect(html).toContain("$200.00");
    expect(html).toContain("MSFT");
    expect(html).toContain("$410.00");
    expect(html).not.toContain("indexed to 100");
  });
});
