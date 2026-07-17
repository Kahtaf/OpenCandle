import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketSparkline } from "../../../gui/web/src/components/market-sparkline.jsx";

describe("MarketSparkline provenance", () => {
  it("always places one muted 10px source caption below the sparkline", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketSparkline, {
        symbol: "AAPL",
        sparkline: {
          status: "ok",
          source: "Yahoo Finance",
          dataAsOf: "2026-07-17",
          points: [210, 212, 211],
        },
      }),
    );

    expect(html).toContain("<figure");
    expect(html.match(/<figcaption/g)).toHaveLength(1);
    expect(html).toContain("text-[10px]");
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("tabular-nums");
    expect(html.indexOf("</svg>")).toBeLessThan(html.indexOf("<figcaption"));
    expect(html).toContain("Yahoo · 2026-07-17");
  });
});
