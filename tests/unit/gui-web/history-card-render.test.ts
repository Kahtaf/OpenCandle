import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HistoryCard } from "../../../gui/web/src/features/renderers/cards/market.jsx";

const bars = [
  { date: "2026-07-14", open: 190, high: 194, low: 189, close: 192, volume: 10_000 },
  { date: "2026-07-15", open: 192, high: 198, low: 191, close: 197, volume: 12_000 },
];

async function renderHistory(message = { toolName: "get_stock_history", details: bars }) {
  const element = React.createElement(HistoryCard, {
    message,
    header: React.createElement("div", null, "Price history"),
  });
  renderToStaticMarkup(element);
  await import("../../../gui/web/src/components/market-chart.jsx");
  await Promise.resolve();
  return renderToStaticMarkup(element);
}

describe("HistoryCard", () => {
  it("renders a MarketChart-backed chart with its header and stat tiles", async () => {
    const html = await renderHistory();

    expect(html).toContain("Price history");
    expect(html).toContain('data-slot="market-chart"');
    expect(html).toContain("$197.00");
    for (const label of ["Period high", "Period low", "First close", "Avg volume"]) {
      expect(html).toContain(label);
    }
  });

  it("derives UTC-midnight chart times for persisted bars without timestamps", async () => {
    const html = await renderHistory();

    expect(html).toContain('dateTime="2026-07-14T00:00:00.000Z"');
    expect(html).toContain('dateTime="2026-07-15T00:00:00.000Z"');
  });

  it("maps finite epoch-second timestamps to MarketChart bar times", async () => {
    const timestampedBars = bars.map((bar, index) => ({
      ...bar,
      timestamp: 1_784_048_400 + index * 300,
    }));
    const html = await renderHistory({
      toolName: "get_stock_history",
      details: timestampedBars,
    });

    expect(html).toContain(`dateTime="${new Date(1_784_048_400_000).toISOString()}"`);
    expect(html).toContain(`dateTime="${new Date(1_784_048_700_000).toISOString()}"`);
  });

  it("renders crypto history through the same MarketChart-backed card", async () => {
    const html = await renderHistory({ toolName: "get_crypto_history", details: { bars } });

    expect(html).toContain('data-slot="market-chart"');
    expect(html).toContain("$197.00");
  });

  it("bounds and contains the chart without rendering range controls", async () => {
    const html = await renderHistory();

    expect(html).toContain("h-[180px] overflow-hidden sm:h-[220px]");
    expect(html).not.toContain('data-slot="market-chart-range-selector"');
    expect(html).not.toMatch(/<button[^>]*>(?:1D|5D|1M|6M|YTD|1Y|5Y|MAX)<\/button>/);
  });

  it("states the first-to-last bar-date window", async () => {
    const html = await renderHistory();

    expect(html).toContain("2026-07-14");
    expect(html).toContain("→");
    expect(html).toContain("2026-07-15");
  });
});
