import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlertsCard } from "../../../gui/web/src/features/home/AlertsCard.jsx";
import { HomeDashboard } from "../../../gui/web/src/features/home/HomeDashboard.jsx";
import { IndicesStrip } from "../../../gui/web/src/features/home/IndicesStrip.jsx";
import { MarketStateAffordanceCard } from "../../../gui/web/src/features/home/MarketStateAffordanceCard.jsx";
import { PortfolioSummaryStrip } from "../../../gui/web/src/features/home/PortfolioSummaryStrip.jsx";
import { WatchlistMovers } from "../../../gui/web/src/features/home/WatchlistMovers.jsx";
import { derivePortfolioDayMove } from "../../../gui/web/src/features/market-state/portfolio-view-model.js";

describe("home dashboard widgets", () => {
  it("renders friendly market names with provider symbols as secondary text", () => {
    const html = renderToStaticMarkup(
      React.createElement(IndicesStrip, {
        quotes: ["^GSPC", "^NDX", "^DJI", "BTC-USD"].map((symbol) => ({
          symbol,
          assetType: symbol === "BTC-USD" ? "crypto" : "index",
          status: "ok",
          price: 6321.45,
          changePercent: 1.25,
          currency: null,
        })),
      }),
    );

    expect(html).toContain("<section");
    expect(html).toContain('aria-labelledby="home-indices-heading"');
    expect(html).toContain('href="/symbol/%5EGSPC"');
    expect(html).toContain("S&amp;P 500");
    expect(html).toContain("Nasdaq 100");
    expect(html).toContain("Dow Jones");
    expect(html).toContain("Bitcoin");
    expect(html).toContain('title="^GSPC"');
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("tabular-nums");
    expect(html).toContain("+1.25%");
    expect(html).not.toMatch(/ticker\s*line/i);
    expect(html).toContain('data-state="loading"');
    expect(html).not.toContain("null");

    expect(renderToStaticMarkup(React.createElement(IndicesStrip, { unavailable: true }))).toBe("");
  });

  it("renders the top five watchlist movers by absolute change with existing freshness copy", () => {
    const quotes = [
      ["FLAT", 0.1],
      ["MID", 1.4],
      ["DROP", -3.2],
      ["GAIN", 2.7],
      ["SMALL", -0.5],
      ["SIXTH", 0.2],
    ].map(([symbol, changePercent], index) => ({
      symbol,
      assetType: "equity",
      status: "ok",
      price: 100 + index,
      changePercent,
      fetchedAt: "2026-07-17T10:00:00.000Z",
    }));
    const html = renderToStaticMarkup(
      React.createElement(WatchlistMovers, {
        watchlistItems: quotes.map(({ symbol }) => ({ symbol })),
        quoteSnapshot: { watchlistQuotes: quotes },
        nowMs: Date.parse("2026-07-17T10:20:00.000Z"),
        timeZone: "UTC",
      }),
    );

    expect(html).toContain('aria-labelledby="home-movers-heading"');
    expect(html.indexOf("DROP")).toBeLessThan(html.indexOf("GAIN"));
    expect(html.indexOf("GAIN")).toBeLessThan(html.indexOf("MID"));
    expect(html).not.toContain("FLAT intraday");
    expect(html).toContain('href="/symbol/DROP"');
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain("↓");
    expect(html).toContain("3.20%");
    expect(html).toContain("Quotes 20m old");
    expect(html).toMatch(/title="Fetched Jul 17, 10:00 AM"/);
    expect(html).toContain('href="/watchlists"');
    expect(html).toContain("View all");
  });

  it("renders portfolio totals and shared day move, degrading unusable day data honestly", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioSummaryStrip, {
        portfolios: [{ id: 1, name: "Core" }],
        quoteSnapshot: {
          portfolioSummaries: [
            {
              portfolioId: 1,
              totalValue: 12500,
              totalCost: 10000,
              totalPnl: 2500,
              totalPnlPercent: 25,
              baseCurrency: "USD",
            },
          ],
          portfolioQuotes: [{ marketValue: 1100, changePercent: 10 }],
        },
      }),
    );

    expect(html).toContain('aria-labelledby="home-portfolio-heading"');
    expect(html).toContain("$12,500.00");
    expect(html).toContain("Today&#x27;s move");
    expect(html).toContain("+$100.00 (+10.0%)");
    expect(html).toContain("+$2,500.00 (+25.0%)");
    expect(html).not.toContain("↑");
    expect(html).not.toContain(" · ");
    expect(html).toContain("tabular-nums");

    const unavailableHtml = renderToStaticMarkup(
      React.createElement(PortfolioSummaryStrip, {
        portfolios: [{ id: 1, name: "Core" }],
        quoteSnapshot: {
          portfolioSummaries: [{ portfolioId: 1, totalValue: 12500, totalPnl: 2500 }],
          portfolioQuotes: [{ marketValue: 1100, changePercent: null }],
        },
      }),
    );
    expect(unavailableHtml).toContain("Unavailable");
    expect(unavailableHtml).not.toContain("Today&#x27;s move</div><div>$0.00");
  });

  it("shows only the largest portfolio currency group and names excluded currencies", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioSummaryStrip, {
        portfolios: [{ id: 1 }, { id: 2 }],
        quoteSnapshot: {
          portfolioSummary: { baseCurrency: "CAD" },
          portfolioSummaries: [
            {
              portfolioId: 1,
              baseCurrency: "CAD",
              totalValue: 20_000,
              totalCost: 18_000,
              totalPnl: 2_000,
            },
            {
              portfolioId: 2,
              baseCurrency: "USD",
              totalValue: 5_000,
              totalCost: 4_000,
              totalPnl: 1_000,
            },
          ],
          portfolioQuotes: [
            { portfolioId: 1, marketValue: 11_000, changePercent: 10, includedInTotals: true },
            { portfolioId: 2, marketValue: 5_500, changePercent: 10, includedInTotals: true },
          ],
        },
      }),
    );

    expect(html).toContain("CAD 20,000.00");
    expect(html).not.toContain("25,000.00");
    expect(html).toContain("USD portfolios excluded");
    expect(html).toContain("+CAD 1,000.00 (+10.0%)");
  });

  it("uses the canonical primary currency instead of ranking unconverted nominal totals", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioSummaryStrip, {
        portfolios: [{ id: 1 }, { id: 2 }],
        quoteSnapshot: {
          portfolioSummary: { baseCurrency: "USD" },
          portfolioSummaries: [
            {
              portfolioId: 1,
              baseCurrency: "JPY",
              totalValue: 1_000_000,
              totalCost: 900_000,
              totalPnl: 100_000,
            },
            {
              portfolioId: 2,
              baseCurrency: "USD",
              totalValue: 20_000,
              totalCost: 18_000,
              totalPnl: 2_000,
            },
          ],
          portfolioQuotes: [
            {
              portfolioId: 2,
              status: "ok",
              includedInTotals: true,
              marketValue: 20_000,
              changePercent: 0,
            },
          ],
        },
      }),
    );

    expect(html).toContain("$20,000.00");
    expect(html).not.toContain("1,000,000.00");
    expect(html).toContain("JPY portfolios excluded");
  });

  it("renders portfolio valuation unavailable when no selected quote is usable", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioSummaryStrip, {
        portfolios: [{ id: 1 }],
        quoteSnapshot: {
          portfolioSummary: { baseCurrency: "USD" },
          portfolioSummaries: [
            {
              portfolioId: 1,
              baseCurrency: "USD",
              totalValue: 0,
              totalCost: 0,
              totalPnl: 0,
            },
          ],
          portfolioQuotes: [
            {
              portfolioId: 1,
              status: "unavailable",
              includedInTotals: false,
              reason: "quote unavailable",
            },
          ],
        },
      }),
    );

    expect(html).toContain("Portfolio valuation unavailable");
    expect(html).not.toContain("$0.00");
  });

  it("does not present a partially valued portfolio as a complete total", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioSummaryStrip, {
        portfolios: [{ id: 1 }],
        quoteSnapshot: {
          portfolioSummary: { portfolioId: 1, baseCurrency: "USD" },
          portfolioSummaries: [
            {
              portfolioId: 1,
              baseCurrency: "USD",
              totalValue: 1000,
              totalCost: 900,
              totalPnl: 100,
            },
          ],
          portfolioQuotes: [
            {
              portfolioId: 1,
              status: "ok",
              includedInTotals: true,
              marketValue: 1000,
            },
            {
              portfolioId: 1,
              status: "unavailable",
              includedInTotals: false,
              reason: "quote unavailable",
            },
          ],
        },
      }),
    );

    expect(html).toContain("Portfolio valuation unavailable");
    expect(html).not.toContain("$1,000.00");
  });

  it("renders a tracked empty portfolio as a valid zero valuation", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioSummaryStrip, {
        portfolios: [{ id: 1 }],
        quoteSnapshot: {
          portfolioSummary: { portfolioId: 1, baseCurrency: "USD" },
          portfolioSummaries: [
            {
              portfolioId: 1,
              baseCurrency: "USD",
              totalValue: 0,
              totalCost: 0,
              totalPnl: 0,
            },
          ],
          portfolioQuotes: [],
        },
      }),
    );

    expect(html).toContain("$0.00");
    expect(html).not.toContain("Portfolio valuation unavailable");
  });

  it("excludes invalid day-move denominators and non-finite totals", () => {
    expect(
      derivePortfolioDayMove([
        { marketValue: 100, changePercent: -100 },
        { marketValue: 110, changePercent: 10 },
      ]),
    ).toBeCloseTo(10);
    expect(
      derivePortfolioDayMove([
        { marketValue: Number.MAX_VALUE, changePercent: 100 },
        { marketValue: Number.MAX_VALUE, changePercent: 100 },
        { marketValue: Number.MAX_VALUE, changePercent: 100 },
      ]),
    ).toBeNull();
  });

  it("renders read-only alert state with icons, sentences, notifications, and navigation", () => {
    const html = renderToStaticMarkup(
      React.createElement(AlertsCard, {
        alerts: [
          {
            id: 7,
            instrumentId: 2,
            enabled: true,
            conditionType: "price_crosses_above",
            conditionJson: { threshold: 200 },
            lastCheckedAt: "2026-07-17T10:00:00.000Z",
          },
        ],
        alertEvents: [{ id: 8, alertRuleId: 7, status: "triggered", triggeredAt: "2026-07-17" }],
        notifications: [{ id: 9, title: "AAPL crossed $200", status: "pending" }],
        instruments: [{ id: 2, symbol: "AAPL" }],
        nowMs: Date.parse("2026-07-17T10:05:00.000Z"),
      }),
    );

    expect(html).toContain('aria-labelledby="home-alerts-heading"');
    expect(html).toContain("AAPL");
    expect(html).toContain("Price crosses above $200.00");
    expect(html).toContain("Armed");
    expect(html).toContain('aria-label="Armed"');
    expect(html).toContain("AAPL crossed $200");
    expect(html).toContain('href="/alerts"');
    expect(html).toContain("focus-visible:ring-2");
    expect(html).not.toContain("Disable");

    const emptyHtml = renderToStaticMarkup(React.createElement(AlertsCard));
    expect(emptyHtml).toContain("Create an alert");
    expect(emptyHtml).toContain('href="/alerts"');
  });

  it("renders one clear navigation action for each empty saved-state domain", () => {
    const watchlistHtml = renderToStaticMarkup(
      React.createElement(MarketStateAffordanceCard, { kind: "watchlist" }),
    );
    const portfolioHtml = renderToStaticMarkup(
      React.createElement(MarketStateAffordanceCard, { kind: "portfolio" }),
    );

    expect(watchlistHtml).toContain("Add a watchlist");
    expect(watchlistHtml).toContain('aria-labelledby="home-watchlist-affordance-heading"');
    expect(watchlistHtml).toContain('data-slot="panel-header"');
    expect(watchlistHtml).toContain('<h2 id="home-watchlist-affordance-heading"');
    expect(watchlistHtml).toContain('href="/watchlists"');
    expect(watchlistHtml.match(/<a /g)).toHaveLength(1);
    expect(portfolioHtml).toContain("Track a portfolio");
    expect(portfolioHtml).toContain('aria-labelledby="home-portfolio-affordance-heading"');
    expect(portfolioHtml).toContain('href="/portfolios"');
    expect(portfolioHtml).toContain("active:scale-[0.96]");
    expect(portfolioHtml).toContain("min-h-10");
  });

  it("composes populated home data below the heading, prompts, and composer", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        HomeDashboard,
        {
          prompts: [["How is Core doing?", "How is my Core portfolio doing?"]],
          onPrompt: () => undefined,
          marketState: {
            watchlists: [{ id: 1, name: "Tech" }],
            watchlist: [{ watchlistId: 1, symbol: "NVDA" }],
            portfolios: [{ id: 2, name: "Core" }],
            portfolio: [{ portfolioId: 2, symbol: "NVDA" }],
            alerts: [],
            alertEvents: [],
            notifications: [],
            instruments: [],
            quoteSnapshot: {
              watchlistQuotes: [{ symbol: "NVDA", status: "ok", price: 190, changePercent: 2 }],
              portfolioSummaries: [
                { portfolioId: 2, totalValue: 1000, totalCost: 900, totalPnl: 100 },
              ],
              portfolioQuotes: [{ marketValue: 1000, changePercent: 2 }],
            },
          },
          indicesState: {
            loading: false,
            unavailable: false,
            quotes: [
              {
                symbol: "BTC-USD",
                assetType: "crypto",
                status: "ok",
                price: 120000,
                changePercent: 1,
              },
            ],
          },
        },
        React.createElement("div", { "data-test": "home-composer" }, "Composer"),
      ),
    );

    expect(html).toContain("What are we watching?");
    expect(html).toContain("text-balance");
    expect(html).toContain("How is Core doing?");
    expect(html.indexOf('data-test="home-composer"')).toBeLessThan(
      html.indexOf('data-slot="home-widget-grid"'),
    );
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("lg:grid-cols-2");
    expect(html).toContain("lg:col-span-2");
    expect(html).toContain('data-slot="home-indices-strip"');
    expect(html).toContain('data-slot="home-watchlist-movers"');
    expect(html).toContain('data-slot="home-portfolio-summary"');
    expect(html).toContain('data-slot="home-alerts-card"');
    expect(html).toContain('data-slot="home-alerts-grid-cell"');
    expect(html).toContain("lg:col-span-2");
    expect(html).not.toContain("Add a watchlist");
    expect(html).not.toContain("Track a portfolio");
  });

  it("shows universal indices and both affordances for a new user", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        HomeDashboard,
        {
          prompts: [["Default prompt", "Default prompt"]],
          onPrompt: () => undefined,
          marketState: { watchlist: [], portfolio: [] },
          indicesState: {
            loading: false,
            unavailable: false,
            quotes: [
              {
                symbol: "^DJI",
                assetType: "index",
                status: "ok",
                price: 45000,
                changePercent: -0.5,
              },
            ],
          },
        },
        React.createElement("div", null, "Composer"),
      ),
    );

    expect(html).toContain("Default prompt");
    expect(html).toContain('href="/symbol/%5EDJI"');
    expect(html).toContain("Add a watchlist");
    expect(html).toContain("Track a portfolio");
    expect(html).not.toContain("transition-all");
  });

  it("uses sized skeletons while saved-state and quote snapshots are loading", () => {
    const structuralHtml = renderToStaticMarkup(
      React.createElement(
        HomeDashboard,
        {
          prompts: [],
          onPrompt: () => undefined,
          marketStateLoading: true,
          marketState: {},
          indicesState: { loading: true, unavailable: false, quotes: [] },
        },
        React.createElement("div", null, "Composer"),
      ),
    );
    expect(structuralHtml.match(/data-slot="home-saved-state-skeleton"/g)).toHaveLength(3);
    expect(structuralHtml).not.toContain("Add a watchlist");

    const quoteHtml = renderToStaticMarkup(
      React.createElement(WatchlistMovers, {
        watchlistItems: [{ symbol: "NVDA" }],
        quoteSnapshot: null,
      }),
    );
    expect(quoteHtml).toContain('data-slot="home-movers-skeleton"');
    expect(quoteHtml).toContain("min-h-[280px]");
    expect(quoteHtml).not.toContain("No watchlist symbols yet");
    expect(quoteHtml).not.toContain("animate-fade-in");

    const emptyMoversHtml = renderToStaticMarkup(React.createElement(WatchlistMovers));
    expect(emptyMoversHtml).toContain("No watchlist symbols yet");

    const emptyPortfolioHtml = renderToStaticMarkup(React.createElement(PortfolioSummaryStrip));
    expect(emptyPortfolioHtml).toContain("No portfolios tracked yet");
  });

  it("keeps symbol rows navigation-only with no chat-run call site", () => {
    const rowSources = ["IndicesStrip.jsx", "WatchlistMovers.jsx"]
      .map((file) => readFileSync(resolve("gui/web/src/features/home", file), "utf-8"))
      .join("\n");

    expect(rowSources).toContain("symbolPageHref(quote.symbol)");
    expect(rowSources).not.toContain("startChatRun");
    expect(rowSources).not.toContain("onPrompt");
  });

  it("keeps the mobile dashboard single-column and horizontally contained", () => {
    const dashboardSource = readFileSync(
      resolve("gui/web/src/features/home/HomeDashboard.jsx"),
      "utf-8",
    );
    const chatPanelSource = readFileSync(
      resolve("gui/web/src/features/chat/ChatPanel.jsx"),
      "utf-8",
    );

    expect(dashboardSource).toContain("grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2");
    expect(dashboardSource).toContain("w-full max-w-[1040px]");
    expect(chatPanelSource).toContain("min-w-0 flex-1 flex-col overflow-hidden");
    expect(dashboardSource).not.toMatch(/min-w-max|overflow-x-(?:auto|scroll)/);
  });

  it("keeps every widget on the shared design and accessibility contracts", () => {
    const widgetFiles = [
      "IndicesStrip.jsx",
      "WatchlistMovers.jsx",
      "PortfolioSummaryStrip.jsx",
      "AlertsCard.jsx",
      "MarketStateAffordanceCard.jsx",
    ];
    const widgetSources = widgetFiles.map((file) => ({
      file,
      source: readFileSync(resolve("gui/web/src/features/home", file), "utf-8"),
    }));
    const allWidgetSource = widgetSources.map(({ source }) => source).join("\n");

    for (const { file, source } of widgetSources) {
      expect(source, file).toContain("Panel");
      expect(source, file).toContain("aria-labelledby");
    }
    expect(allWidgetSource).not.toContain("transition-all");
    expect(allWidgetSource).not.toContain("animate-fade");
    expect(allWidgetSource).toContain("tabular-nums");
    expect(allWidgetSource).toContain("active:scale-[0.96]");
    expect(allWidgetSource).toContain("min-h-10");
    expect(allWidgetSource).toContain("focus-visible:ring-2");
    expect(allWidgetSource).toContain("quoteFlashClass");
    expect(allWidgetSource).toContain("degradedQuoteBadge");

    const moversHtml = renderToStaticMarkup(
      React.createElement(WatchlistMovers, {
        watchlistItems: [{ symbol: "DROP" }],
        quoteSnapshot: {
          watchlistQuotes: [
            {
              symbol: "DROP",
              assetType: "equity",
              status: "ok",
              price: 95,
              changePercent: -3.2,
            },
          ],
        },
      }),
    );
    expect(moversHtml).not.toMatch(/ticker\s*line/i);
    expect(moversHtml).toContain('data-state="loading"');
    expect(moversHtml).toContain("↓");
  });
});
