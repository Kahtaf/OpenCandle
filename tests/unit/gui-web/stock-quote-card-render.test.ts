import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StockQuoteCard } from "../../../gui/web/src/features/renderers/cards/market.jsx";

describe("StockQuoteCard", () => {
  it("fills missing valuation fields from session market facts", () => {
    const html = renderToStaticMarkup(
      React.createElement(StockQuoteCard, {
        message: {
          toolName: "get_stock_quote",
          details: {
            symbol: "MU",
            price: 919.25,
            change: -65.5,
            changePercent: -6.65,
            previousClose: 984.75,
            open: 922.84,
            high: 939.99,
            low: 891.66,
            volume: 40_400_000,
            marketCap: 0,
            pe: null,
            week52Low: 103.38,
            week52High: 1255,
            timestamp: 1_783_443_600_000,
          },
        },
        header: null,
        sessionMarketFacts: {
          MU: {
            symbol: "MU",
            pe: 22.28,
            marketCap: 103_000_000_000,
          },
        },
      }),
    );

    expect(html).toContain("22.28");
    expect(html).toContain("$103.00B");
    expect(html).not.toContain("<div>—</div>");
  });
});
