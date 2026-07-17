import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MarketChart } from "../../../gui/web/src/components/market-chart.jsx";

const bars = [
  { time: 1_784_204_100, open: 190, high: 192, low: 189, close: 191, volume: 10_000 },
  { time: 1_784_204_400, open: 191, high: 198, low: 190, close: 197.14, volume: 12_000 },
];

const primarySeries = { symbol: "AAPL", bars };

function renderChart(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    React.createElement(MarketChart, {
      series: [primarySeries],
      mode: "area",
      height: 320,
      ...props,
    }),
  );
}

describe("MarketChart static shell", () => {
  it("labels the sized chart container with symbol, range, latest close, and signed change", () => {
    const html = renderChart({ className: "consumer-chart", range: "1D" });

    expect(html).toContain("consumer-chart");
    expect(html).toContain("height:320px");
    expect(html).toMatch(/aria-label="[^"]*AAPL[^"]*1D[^"]*197\.14[^"]*\+6\.14[^"]*"/);
  });

  it("renders the controlled range selector with accessible state and touch targets", () => {
    const html = renderChart({ range: "6M", onRangeChange: vi.fn() });
    const buttons = [...html.matchAll(/<button([^>]*)>([^<]+)<\/button>/g)];

    expect(buttons.map((match) => match[2])).toEqual([
      "1D",
      "5D",
      "1M",
      "6M",
      "YTD",
      "1Y",
      "5Y",
      "MAX",
    ]);
    expect(buttons).toHaveLength(8);
    for (const [attributes] of buttons.map((match) => [match[1]])) {
      expect(attributes).toContain("min-h-10");
      expect(attributes).toContain("min-w-10");
      expect(attributes).toContain("active:scale-[0.96]");
    }
    expect(buttons.find((match) => match[2] === "6M")?.[1]).toContain('aria-selected="true"');
    expect(html).toContain('data-slot="market-chart-range-scroll"');
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain('data-slot="market-chart-range-fade"');
    expect(
      html.match(/data-slot="market-chart-range-selector"[^>]*class="([^"]*)"/)?.[1],
    ).not.toContain("absolute");
    expect(html.indexOf('data-slot="market-chart-range-selector"')).toBeLessThan(
      html.indexOf('data-slot="market-chart-plot"'),
    );
    expect(html).not.toContain("transition-all");
  });

  it("omits every range button when no range callback is provided", () => {
    const html = renderChart({ range: "1D" });

    for (const label of ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"]) {
      expect(html).not.toContain(`>${label}</button>`);
    }
  });

  it("renders a text-token legend and colored dot for each indexed symbol", () => {
    const html = renderChart({
      mode: "indexed",
      series: [primarySeries, { symbol: "MSFT", bars }],
    });

    expect(html).toContain('data-slot="market-chart-legend"');
    for (const symbol of ["AAPL", "MSFT"]) {
      expect(html).toMatch(
        new RegExp(
          `data-symbol="${symbol}"[\\s\\S]*?data-slot="series-color-dot"[\\s\\S]*?<span class="[^"]*text-(?:foreground|muted-foreground)[^"]*">${symbol}</span>`,
        ),
      );
    }
    expect(html).not.toMatch(/<span[^>]+style="[^"]*color:[^"]*"[^>]*>(?:AAPL|MSFT)<\/span>/);
  });

  it("omits the legend for one rendered series", () => {
    expect(renderChart()).not.toContain('data-slot="market-chart-legend"');
  });

  it("contains no third-party embed", () => {
    const html = renderChart();

    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/src="[^"]*tradingview\.com/i);
  });

  it("reserves a footer outside the plot for TradingView attribution", () => {
    const html = renderChart();

    expect(html).toContain('data-slot="market-chart-attribution"');
    expect(html).toContain('href="https://www.tradingview.com/"');
    expect(html.indexOf('data-slot="market-chart-plot"')).toBeLessThan(
      html.indexOf('data-slot="market-chart-attribution"'),
    );
  });

  it("renders a fixed sparse horizontal token grid over the plot", () => {
    const html = renderChart();

    expect(html).toContain('data-slot="market-chart-horizontal-grid"');
    expect(html.match(/data-slot="market-chart-grid-row"/g)).toHaveLength(5);
    expect(html).toContain("border-border/45");
  });
});
