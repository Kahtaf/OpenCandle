import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  resolveTickerLineInstrument,
  tickerLineProviderSparklineUrl,
} from "../../../gui/shared/ticker-line.js";
import { MarketSparkline } from "../../../gui/web/src/components/market-sparkline.jsx";

describe("MarketSparkline provenance", () => {
  it("renders the Ticker Line SVG with its market parameter and source caption", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketSparkline, {
        symbol: "AAPL",
        assetType: "equity",
      }),
    );

    expect(html).toContain("<figure");
    expect(html.match(/<figcaption/g)).toHaveLength(1);
    expect(html).toContain("text-[10px]");
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("tabular-nums");
    expect(html.indexOf("<img")).toBeLessThan(html.indexOf("<figcaption"));
    expect(html).toContain("/api/market-state/sparkline?symbol=AAPL&amp;assetType=equity");
    expect(html).not.toContain("ticker-line.dev");
    expect(html).toContain("Ticker Line · 1D");
    expect(html).not.toContain("Yahoo");
  });

  it.each([
    ["BTC-USD", "crypto", { ticker: "BTC/USD", market: "crypto" }],
    ["ETH-EUR", "crypto", { ticker: "ETH/EUR", market: "crypto" }],
    ["EURUSD=X", "unknown", { ticker: "EUR/USD", market: "forex" }],
    ["^GSPC", "index", { ticker: "SPX500/USD", market: "index" }],
    ["^NDX", "index", { ticker: "NAS100/USD", market: "index" }],
    ["^DJI", "index", { ticker: "US30/USD", market: "index" }],
    ["GC=F", "commodity", { ticker: "XAU/USD", market: "commodity" }],
    ["BRK-B", "equity", { ticker: "BRK.B", market: "stock" }],
  ])("translates %s into a supported Ticker Line instrument", (symbol, assetType, expected) => {
    expect(resolveTickerLineInstrument(symbol, assetType)).toEqual(expected);
  });

  it("renders an honest fallback for unsupported options and futures", () => {
    expect(tickerLineProviderSparklineUrl("AAPL260117C00200000", "option")).toBeNull();
    expect(tickerLineProviderSparklineUrl("ES=F", "unknown")).toBeNull();
    const html = renderToStaticMarkup(
      React.createElement(MarketSparkline, {
        symbol: "AAPL260117C00200000",
        assetType: "option",
      }),
    );
    expect(html).toContain("Ticker Line · unavailable");
    expect(html).not.toContain("<img");
  });
});
