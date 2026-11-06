import { JSDOM } from "jsdom";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PortfolioPage } from "../../../gui/web/src/features/market-state/PortfolioPage.jsx";

function render(
  status: string,
  lots = [{ id: 1, symbol: "SAP", quantity: 1, avgCost: 8, currency: "EUR" }],
) {
  return renderToStaticMarkup(
    React.createElement(PortfolioPage, {
      state: {
        portfolio: lots,
        quoteSnapshot: {
          portfolioSummary: { status, baseCurrency: "USD", totalValue: null, valuedSubtotal: 12 },
          portfolioQuotes: [
            {
              lotId: 1,
              symbol: "SAP",
              status: "ok",
              reportingCurrency: "USD",
              marketValue: 12,
              includedInTotals: true,
              valuedAllocationPercent: 100,
            },
          ],
        },
      },
      filter: "",
      setFilter: () => {},
    }),
  );
}

it("explains partial allocation when priced holdings already exist", () => {
  const html = render("partial");
  expect(html).toContain(
    "Full allocation is unavailable because some holdings could not be valued",
  );
  expect(html).toContain("of valued holdings");
  expect(html).not.toContain("Allocation appears once a holding has a priced position");
});
it("preserves the genuinely empty portfolio state", () => {
  const html = render("empty", []);
  expect(html).toContain("No holdings yet");
  expect(html).not.toContain("Full allocation is unavailable");
});

it.each([false, true])(
  "shows native evidence and sourced FX without inventing reporting gains (last session %s)",
  (lastSession) => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioPage, {
        state: {
          portfolio: [{ id: 1, symbol: "SAP", quantity: 2, avgCost: 8, currency: "EUR" }],
          quoteSnapshot: {
            portfolioSummary: {
              status: "complete",
              baseCurrency: "USD",
              totalValue: 25,
              totalPnl: null,
            },
            portfolioQuotes: [
              {
                lotId: 1,
                symbol: "SAP",
                status: "ok",
                reportingCurrency: "USD",
                quoteCurrency: "EUR",
                currentPrice: 10,
                marketValue: 25,
                pnl: null,
                totalCost: null,
                includedInTotals: true,
                nativeValue: { amount: 20, currency: "EUR" },
                nativePnl: { amount: 4, currency: "EUR" },
                nativeChangePercent: 10,
                securityObservedAt: Date.parse("2026-11-06T20:00:00Z"),
                fx: {
                  status: "ok",
                  method: "direct",
                  source: "EUR",
                  target: "USD",
                  rate: 1.25,
                  lastSession,
                  observedAt: Date.parse("2026-11-06T19:00:00Z"),
                  legs: [{ provider: "yahoo", requestedSymbol: "EURUSD=X" }],
                },
              },
            ],
          },
        },
        filter: "",
        setFilter: () => {},
      }),
    );
    const document = new JSDOM(html).window.document;
    const summary = document.querySelector('[data-slot="portfolio-summary-stats"]');
    expect(summary?.textContent).toContain("Market value$25.00");
    expect(summary?.textContent).toContain("Total gain—");
    expect(summary?.textContent).toContain("Today's change—");
    for (const selector of [
      '[data-slot="portfolio-lot-row"]',
      '[data-slot="mobile-portfolio-holding"]',
    ]) {
      const text = document.querySelector(selector)?.textContent;
      expect(text).toContain("Native value: EUR 20.00");
      expect(text).toContain("Native price P&L: EUR 4.00");
      expect(text).toContain("Native daily change: 10.00%");
      expect(text).toContain("Security: 2026-11-06T20:00:00.000Z");
      expect(text).toContain(
        `FX EUR → USD: 1.25 · ${lastSession ? "last session" : "observed"} 2026-11-06T19:00:00.000Z · yahoo EURUSD=X`,
      );
    }
  },
);
