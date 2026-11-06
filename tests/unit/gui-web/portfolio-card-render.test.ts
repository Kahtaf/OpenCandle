import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  CorrelationCard,
  PortfolioCard,
} from "../../../gui/web/src/features/renderers/cards/portfolio.jsx";

it.each(["EUR", "GBP", "USD"])("labels aggregate P&L in %s", (baseCurrency) => {
  const html = renderToStaticMarkup(
    React.createElement(PortfolioCard, {
      message: {
        details: {
          baseCurrency,
          totalValue: 25,
          totalCost: 20,
          totalPnl: 5,
          totalPnlPercent: 25,
          positions: [
            {
              lotId: 1,
              symbol: "SAP",
              shares: 1,
              avgCost: 20,
              currency: baseCurrency,
              marketValue: 25,
              pnlPercent: 25,
              allocationPercent: 100,
            },
          ],
        },
      },
      text: "",
      header: null,
    }),
  );
  expect(html).toContain(`${baseCurrency} 5.00`);
  expect(html).not.toContain("$5.00");
});

describe("CorrelationCard", () => {
  it("marks matrix symbols as row headers", () => {
    const html = renderToStaticMarkup(
      React.createElement(CorrelationCard, {
        header: React.createElement("h2", null, "Correlation"),
        text: "",
        message: {
          details: {
            symbols: ["AAPL", "NVDA"],
            matrix: {
              AAPL: { AAPL: 1, NVDA: 0.5 },
              NVDA: { AAPL: 0.5, NVDA: 1 },
            },
          },
        },
      }),
    );

    expect(html).toContain('<th scope="row"');
    expect(html).toContain('<th scope="col"');
  });
});

it("renders converted portfolio values separately from unavailable P&L", async () => {
  const { PortfolioCard } = await import(
    "../../../gui/web/src/features/renderers/cards/portfolio.jsx"
  );
  const html = renderToStaticMarkup(
    React.createElement(PortfolioCard, {
      message: {
        details: {
          baseCurrency: "EUR",
          totalValue: 25,
          totalPnl: null,
          totalCost: null,
          positions: [
            {
              lotId: 1,
              symbol: "SAP",
              shares: 2,
              avgCost: 8,
              currency: "USD",
              marketValue: 25,
              pnlPercent: null,
            },
          ],
        },
      },
      text: "",
      header: null,
    }),
  );
  expect(html).toContain("EUR 25");
  expect(html).toContain("P&amp;L unavailable");
  expect(html).not.toContain("$25");
});
