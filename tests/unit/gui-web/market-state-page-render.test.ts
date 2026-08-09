import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../../../gui/web/src/components/ui/tooltip.jsx";
import { AlertsPage } from "../../../gui/web/src/features/market-state/AlertsPage.jsx";
import {
  AlertCreateForm,
  alertConditionFormFields,
  alertInstrumentArgs,
  alertThresholdFromLink,
  ContextPanel,
  clampComboboxActiveIndex,
  getHoldingAutofillValues,
  HoldingForm,
  holdingInstrumentArgs,
  invokeMarketStateMutation,
  isAlertDraftValid,
  MarketStatePage,
  nextComboboxActiveIndex,
  nextStateTabIndex,
  normalizeExactHostedSymbol,
  PendingSubmitButton,
  PortfolioRenameForm,
  StateTabs,
  SymbolActionPanel,
  SymbolSearchInput,
  WatchlistRenameForm,
} from "../../../gui/web/src/features/market-state/MarketStatePage.jsx";
import { PortfolioPage } from "../../../gui/web/src/features/market-state/PortfolioPage.jsx";
import { ReportsPage } from "../../../gui/web/src/features/market-state/ReportsPage.jsx";
import { WatchlistPage } from "../../../gui/web/src/features/market-state/WatchlistPage.jsx";
import { RuntimeTransportProvider } from "../../../gui/web/src/runtime/runtime-transport-provider.jsx";

vi.mock("vaul", async () => {
  const ReactModule = await import("react");
  const createElement = ReactModule.createElement;
  return {
    Drawer: {
      Root: ({ children }: { children: React.ReactNode }) =>
        createElement(React.Fragment, null, children),
      Portal: ({ children }: { children: React.ReactNode }) =>
        createElement(React.Fragment, null, children),
      Overlay: ({ className }: { className?: string }) =>
        createElement("div", { className, "data-vaul-overlay": "" }),
      Content: ({
        children,
        className,
        ...props
      }: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }) =>
        createElement(
          "div",
          {
            ...props,
            className,
            "data-vaul-drawer": "",
            "data-vaul-drawer-direction": "bottom",
          },
          children,
        ),
      Title: ({ children }: { children: React.ReactNode }) => createElement("span", null, children),
    },
  };
});

describe("MarketStatePage rendering", () => {
  it("links watchlist symbols to their encoded symbol pages while keeping the inspector", () => {
    const html = renderToStaticMarkup(
      React.createElement(WatchlistPage, {
        loading: false,
        state: {
          watchlists: [{ id: 1, name: "Default", isDefault: true }],
          watchlist: [
            {
              id: 10,
              watchlistId: 1,
              instrumentId: 4,
              symbol: "^GSPC",
              name: "S&P 500",
            },
          ],
          alerts: [],
          alertEvents: [],
          instruments: [],
          portfolio: [],
          quoteSnapshot: { watchlistQuotes: [], portfolioQuotes: [] },
        },
        filter: "",
        setFilter: () => undefined,
        readOnly: false,
        openPanel: () => undefined,
        invokeTool: () => undefined,
        navigate: () => undefined,
        renderPageHeader: () => null,
      }),
    );

    expect(html).toContain('href="/symbol/%5EGSPC"');
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain('aria-label="^GSPC details"');
    expect(html).toContain("Create alert");
    // The rail navigates from the ticker itself, so the big action stays a real
    // action instead of a second link to the same page.
    expect(html).not.toContain("Open full page");
    expect(html).toContain('data-slot="inspector-symbol-link"');
    expect(html).toContain("Open symbol page");
    expect(html.match(/href="\/symbol\/%5EGSPC"/g)).toHaveLength(2);
  });

  it("renders the watchlist as a quote board with signed market data and row actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(WatchlistPage, {
          loading: false,
          state: {
            watchlists: [{ id: 1, name: "Default", isDefault: true }],
            watchlist: [
              {
                id: 10,
                watchlistId: 1,
                instrumentId: 4,
                symbol: "AAPL",
                assetType: "equity",
                name: "Apple Inc.",
                exchange: "NMS",
              },
            ],
            alerts: [
              {
                id: 1,
                instrumentId: 4,
                enabled: true,
                conditionType: "price_crosses_above",
                conditionJson: { threshold: 200 },
              },
            ],
            alertEvents: [],
            instruments: [],
            portfolio: [],
            quoteSnapshot: {
              watchlistQuotes: [
                {
                  itemId: 10,
                  instrumentId: 4,
                  symbol: "AAPL",
                  assetType: "equity",
                  name: "Apple Inc. quote name",
                  status: "ok",
                  price: 190,
                  change: 1.25,
                  changePercent: 0.66,
                  volume: 1234567,
                  dayLow: 188,
                  dayHigh: 191,
                  week52Low: 150,
                  week52High: 220,
                  marketState: "POST",
                  extendedPrice: 83.02,
                  extendedChange: -0.53,
                  extendedChangePercent: -0.64,
                  extendedAsOf: "2026-06-12T20:14:00.000Z",
                },
              ],
              portfolioQuotes: [],
            },
          },
          filter: "",
          setFilter: () => undefined,
          readOnly: false,
          openPanel: () => undefined,
          invokeTool: () => undefined,
          renderPageHeader: () => null,
        }),
      ),
    );

    expect(html).toContain("Apple Inc. quote name");
    // Chart-first trend cell: no column label, no caption, just the chart.
    expect(html).not.toContain("24 hr sparkline");
    expect(html).toContain(">Trend</span>");
    expect(html).toContain('data-slot="market-sparkline"');
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/ticker\s*line/i);
    expect(html).toContain('data-state="loading"');
    expect(html).toContain("animate-pulse");
    expect(html).toContain('data-slot="mobile-watchlist-row"');
    expect(html).toContain('data-slot="watchlist-inspector-sheet"');
    expect(html).not.toContain("ticker-line.com");
    expect(html).not.toContain("ticker-line.dev");
    expect(html).toContain("Price");
    expect(html).toContain("Change");
    expect(html).toContain("Volume");
    expect(html).not.toContain("Signals");
    expect(html).not.toContain("No alerts");
    expect(html).toContain('data-slot="watchlist-alert-chip"');
    expect(html).toContain('aria-label="1 active alert for AAPL"');
    // One line, one colour: signed money carries the percent inline.
    expect(html).toContain("+$1.25 (+0.66%)");
    expect(html).toContain("After hours");
    expect(html).toContain("$83.02");
    expect(html).toContain("−0.64%");
    expect(html).not.toContain("−$0.53");
    expect(html).toContain('data-slot="extended-session-dot"');
    const extendedHoursQuoteClasses = html.match(
      /data-slot="extended-hours-quote"[^>]*? class="([^"]+)"/,
    )?.[1];
    expect(extendedHoursQuoteClasses?.split(" ")).not.toContain("hidden");
    expect(html).toContain("Day range");
    expect(html).toContain("52-week range");
    expect(html).toContain("Create alert");
    expect(html).toContain('aria-label="Actions for AAPL"');
    expect(html).toContain("bg-brand text-brand-foreground");
    // Removal is a quiet secondary that opens the existing confirm dialog.
    expect(html).toContain('data-slot="inspector-remove"');
    expect(html).toContain("Remove from watchlist");
    expect(html).not.toContain("border-destructive/40 bg-destructive/10 text-foreground");
  });

  it("marks no watchlist row as selected while the detail rail is not on screen", () => {
    // The desktop table renders from sm, but the rail only appears at xl. Below
    // that breakpoint nothing is showing the fallback row, so claiming it as the
    // current selection would announce a selection the reader never made.
    const html = renderToStaticMarkup(
      React.createElement(WatchlistPage, {
        loading: false,
        state: {
          watchlists: [{ id: 1, name: "Default", isDefault: true }],
          watchlist: [
            { id: 10, watchlistId: 1, instrumentId: 4, symbol: "AAPL", name: "Apple Inc." },
            { id: 11, watchlistId: 1, instrumentId: 5, symbol: "MSFT", name: "Microsoft" },
          ],
          alerts: [],
          alertEvents: [],
          instruments: [],
          portfolio: [],
          quoteSnapshot: { watchlistQuotes: [], portfolioQuotes: [] },
        },
        filter: "",
        setFilter: () => undefined,
        readOnly: false,
        openPanel: () => undefined,
        invokeTool: () => undefined,
        navigate: () => undefined,
        renderPageHeader: () => null,
      }),
    );

    expect(html).toContain('aria-selected="false"');
    expect(html).not.toContain('aria-selected="true"');
  });

  it("keeps the quote-board skeleton visible while watchlist data loads", () => {
    const html = renderToStaticMarkup(
      React.createElement(WatchlistPage, {
        loading: true,
        state: { watchlists: [], watchlist: [], alerts: [], quoteSnapshot: null },
        filter: "",
        setFilter: () => undefined,
        readOnly: false,
        openPanel: () => undefined,
        invokeTool: () => undefined,
        renderPageHeader: () => null,
      }),
    );

    expect(html).toContain('data-slot="watchlist-skeleton"');
    expect(html).not.toContain("No tickers yet");
  });

  it("keeps the portfolio skeleton visible while holdings load", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioPage, {
        loading: true,
        state: { portfolios: [], portfolio: [], quoteSnapshot: null },
        filter: "",
        setFilter: () => undefined,
        readOnly: false,
        openPanel: () => undefined,
        invokeTool: () => undefined,
        renderPageHeader: () => null,
      }),
    );

    expect(html).toContain('data-slot="portfolio-skeleton"');
    expect(html).not.toContain("No holdings yet");
    // One loading vocabulary: shaped skeletons for the stats, the allocation and
    // the table, never a data cell filled with prose or an em dash.
    expect(html).toContain('data-slot="portfolio-summary-loading"');
    expect(html).toContain('data-slot="allocation-donut-loading"');
    expect(html).toContain('aria-label="Loading holdings"');
    expect(html).not.toContain("—");
  });

  it("offers the primary action from the empty portfolio and hides the stat header", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioPage, {
        loading: false,
        state: {
          portfolios: [{ id: 1, name: "Default", isDefault: true }],
          portfolio: [],
          quoteSnapshot: { portfolioQuotes: [] },
        },
        filter: "",
        setFilter: () => undefined,
        readOnly: false,
        openPanel: () => undefined,
        invokeTool: () => undefined,
        renderPageHeader: () => null,
      }),
    );

    expect(html).toContain("No holdings yet");
    expect(html).toContain(
      "Add a holding when you are ready, or keep using watchlists without a portfolio.",
    );
    expect(html).not.toContain('data-slot="portfolio-summary"');
    expect(html).not.toContain("Market value");
    expect(html).not.toContain("Search holdings");
  });

  it("links desktop and mobile portfolio symbols to encoded symbol pages", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioPage, {
        loading: false,
        state: {
          portfolios: [{ id: 1, name: "Default", isDefault: true }],
          portfolio: [
            {
              id: 1,
              portfolioId: 1,
              symbol: "^GSPC",
              name: "S&P 500",
              quantity: 2,
              avgCost: 5000,
              currency: "USD",
            },
          ],
          quoteSnapshot: { portfolioQuotes: [] },
        },
        filter: "",
        setFilter: () => undefined,
        readOnly: false,
        openPanel: () => undefined,
        invokeTool: () => undefined,
        navigate: () => undefined,
        renderPageHeader: () => null,
      }),
    );

    expect(html.match(/href="\/symbol\/%5EGSPC"/g)).toHaveLength(2);
    expect(html).toContain("focus-visible:ring-2");
    expect(html).toContain('aria-label="Expand ^GSPC lots"');
  });

  it("renders skeleton stats, not prose, while portfolio totals are still loading", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioPage, {
        loading: false,
        state: {
          portfolios: [{ id: 1, name: "Default", isDefault: true }],
          portfolio: [
            {
              id: 1,
              portfolioId: 1,
              symbol: "AAPL",
              assetType: "equity",
              name: "Apple Inc.",
              quantity: 2,
              avgCost: 100,
              currency: "USD",
            },
          ],
          quoteSnapshot: { portfolioQuotes: [] },
        },
        filter: "",
        setFilter: () => undefined,
        readOnly: false,
        openPanel: () => undefined,
        invokeTool: () => undefined,
        renderPageHeader: () => null,
      }),
    );

    expect(html).toContain('data-slot="portfolio-summary-loading"');
    expect(html).toContain("animate-pulse");
    expect(html).not.toContain("Totals appear once quotes load.");
  });

  it("opens the portfolio on a stat header with allocation beside it and a diet holdings table", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioPage, {
        loading: false,
        state: {
          portfolios: [{ id: 1, name: "Default", isDefault: true }],
          portfolio: [
            {
              id: 1,
              portfolioId: 1,
              symbol: "AAPL",
              assetType: "equity",
              name: "Apple Inc.",
              quantity: 2,
              avgCost: 100,
              currency: "USD",
            },
            {
              id: 2,
              portfolioId: 1,
              symbol: "NVDA",
              assetType: "equity",
              name: "NVIDIA Corporation",
              quantity: 1,
              avgCost: 100,
              currency: "USD",
            },
          ],
          quoteSnapshot: {
            portfolioQuotes: [
              {
                lotId: 1,
                assetType: "equity",
                name: "Apple Inc. quote name",
                status: "ok",
                includedInTotals: true,
                totalCost: 200,
                marketValue: 300,
                pnl: 100,
                allocationPercent: 60,
                currentPrice: 150,
                changePercent: 1,
                currency: "USD",
                marketState: "PRE",
                extendedPrice: 151.25,
                extendedChange: 1.25,
                extendedChangePercent: 0.83,
              },
              {
                lotId: 2,
                assetType: "equity",
                name: "NVIDIA Corporation quote name",
                status: "ok",
                includedInTotals: true,
                totalCost: 100,
                marketValue: 200,
                pnl: 100,
                allocationPercent: 40,
                currentPrice: 200,
                changePercent: -1,
                currency: "USD",
              },
            ],
            portfolioSummary: {
              totalValue: 500,
              totalPnl: 200,
              totalPnlPercent: 66.67,
              baseCurrency: "USD",
              excludedFromTotals: [{ symbol: "SHOP.TO", currency: "CAD", reason: "CAD" }],
            },
          },
        },
        filter: "",
        setFilter: () => undefined,
        readOnly: false,
        openPanel: () => undefined,
        invokeTool: () => undefined,
        renderPageHeader: () => null,
      }),
    );

    // The page opens on the three figures a holder checks first, in that order,
    // before any table row.
    expect(html.indexOf("Market value")).toBeLessThan(html.indexOf("Today&#x27;s change"));
    expect(html.indexOf("Today&#x27;s change")).toBeLessThan(html.indexOf("Total gain"));
    expect(html.indexOf("Market value")).toBeLessThan(html.indexOf("Holdings"));
    expect(html).toContain('data-slot="portfolio-summary"');
    expect(html).toContain('data-slot="portfolio-summary-stats"');
    expect(html).not.toContain("Portfolio value");
    expect(html).not.toContain("All time");
    // Today's change is stated in currency, not as a bare percent.
    expect(html).toContain("+$0.95");
    expect(html).toContain("+0.2%");
    expect(html).not.toContain("today ·");
    // Allocation sits beside the totals it explains, not buried under the table.
    expect(html).toContain('data-slot="allocation-donut-loading"');
    expect(html.indexOf('data-slot="allocation-donut-loading"')).toBeLessThan(
      html.indexOf("Holdings"),
    );
    expect(html).toContain("NVDA");
    expect(html.indexOf("Holdings")).toBeLessThan(html.indexOf("Add holding"));
    // Partial totals stay explicit and stay next to the total they qualify.
    expect(html).toContain('data-slot="portfolio-excluded-note"');
    expect(html).toContain("Kept out of the USD total: SHOP.TO (CAD)");
    expect(html.indexOf('data-slot="portfolio-excluded-note"')).toBeLessThan(
      html.indexOf("Holdings"),
    );
    // Column diet: gain dollars and percent share one cell, the sparkline has no
    // header label, and no column exists purely to hold row actions.
    expect(html).toContain(">Price</th>");
    expect(html).toContain(">Today</th>");
    expect(html).toContain(">Value</th>");
    expect(html).toContain(">Total gain</th>");
    // Allocation rides with the value it comes from instead of taking a column.
    expect(html).not.toContain(">Allocation</th>");
    expect(html).toContain("60.0% of portfolio");
    expect(html).toContain(">Quantity</th>");
    expect(html).toContain(">Avg cost</th>");
    expect(html).not.toContain("24 hr sparkline");
    expect(html).not.toContain("Total Gain/Loss");
    expect(html).not.toContain("% of Portfolio");
    expect(html).not.toContain("Avg. Cost Basis");
    expect(html).not.toContain(">Actions</th>");
    expect(html).toContain("+$100.00 (+50.0%)");
    expect(html).toContain("min-w-[900px]");
    expect(html).not.toContain("min-w-[920px]");
    expect(html).toContain('data-slot="portfolio-lot-row"');
    expect(html).toContain('aria-label="Actions for the AAPL lot"');
    expect(html).not.toContain("font-mono");
    expect(html).not.toContain("<img");
    expect(html).not.toMatch(/ticker\s*line/i);
    expect(html).toContain('data-state="loading"');
    expect(html).not.toContain("ticker-line.dev");
    expect(html).toContain('data-slot="avg-cost-basis"');
    expect(html).toContain('data-slot="mobile-portfolio-holding"');
    expect(html).toContain("focus-visible:ring-inset");
    expect(html).toContain("Apple Inc. quote name");
    expect(html).toContain("NVIDIA Corporation quote name");
    expect(html).toContain("Pre-market");
    expect(html).toContain("$151.25");
    expect(html).toContain("+0.83%");
    expect(html).toContain("transition-transform duration-150");
    expect(html).toContain("transition-[grid-template-rows] duration-150");
  });

  it("prices a foreign-currency holding in its own currency without touching base totals", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioPage, {
        loading: false,
        state: {
          portfolios: [{ id: 1, name: "Default", isDefault: true }],
          portfolio: [
            {
              id: 1,
              portfolioId: 1,
              symbol: "AAPL",
              assetType: "equity",
              name: "Apple Inc.",
              quantity: 2,
              avgCost: 100,
              currency: "USD",
            },
            {
              id: 2,
              portfolioId: 1,
              symbol: "SAP.DE",
              assetType: "equity",
              name: "SAP SE",
              quantity: 10,
              avgCost: 150,
              currency: "EUR",
            },
          ],
          quoteSnapshot: {
            portfolioQuotes: [
              {
                lotId: 1,
                status: "ok",
                includedInTotals: true,
                totalCost: 200,
                marketValue: 300,
                pnl: 100,
                allocationPercent: 100,
                currentPrice: 150,
                changePercent: 1,
                currency: "USD",
              },
              {
                lotId: 2,
                status: "ok",
                includedInTotals: false,
                totalCost: 1500,
                marketValue: 1686.4,
                pnl: 186.4,
                currentPrice: 168.64,
                changePercent: 0.75,
                currency: "EUR",
                reason: "No FX conversion from EUR to USD",
              },
            ],
            portfolioSummary: {
              portfolioId: 1,
              totalValue: 300,
              totalPnl: 100,
              totalPnlPercent: 50,
              baseCurrency: "USD",
              excludedFromTotals: [
                {
                  symbol: "SAP.DE",
                  currency: "EUR",
                  reason: "No FX conversion from EUR to USD",
                },
              ],
            },
          },
        },
        filter: "",
        setFilter: () => undefined,
        readOnly: false,
        openPanel: () => undefined,
        invokeTool: () => undefined,
        renderPageHeader: () => null,
      }),
    );

    // The holding keeps the price, day change and value the watchlist already
    // shows for it, stated in euros.
    expect(html).toContain("EUR 168.64");
    expect(html).toContain("EUR 1,686.40");
    expect(html).toContain("+EUR 186.40");
    // Its allocation is stated as excluded, never as a share of the USD total.
    expect(html).toContain("Kept out of the total");
    expect(html).toContain("Kept out of the USD total: SAP.DE (No FX conversion from EUR to USD)");
    // Today's change stays the base-currency figure for AAPL alone.
    expect(html).toContain("+$2.97");
    expect(html).not.toContain("$1,686.40");
  });

  it("renders market-state panels as overlay sheets without reserving page width", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(
          ContextPanel,
          {
            title: "Edit Alert",
            onClose: () => undefined,
          },
          React.createElement("div", null, "Panel content"),
        ),
      ),
    );

    expect(html).toContain("data-vaul-drawer");
    expect(html).toContain('data-side="right"');
    expect(html).toContain("inset-x-2");
    expect(html).toContain("backdrop-blur-[2px]");
    expect(html).toContain("h-1 w-9");
    expect(html).toContain("bg-secondary");
    expect(html).not.toContain("bg-card");
  });

  it("keeps market-state content in a stable single column while a form sheet is open", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "watchlists",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("flex min-w-0 flex-col gap-3");
    expect(html).not.toContain("xl:grid-cols-[minmax(0,1fr)_380px]");
  });

  it("renders market-state tabs with shared tab chrome and touch-sized rename controls", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        TooltipProvider,
        null,
        React.createElement(StateTabs, {
          items: [
            { id: 1, name: "MAG7" },
            { id: 2, name: "ETFs" },
          ],
          activeItem: { id: 1, name: "MAG7" },
          counts: new Map([
            [1, 7],
            [2, 3],
          ]),
          readOnly: false,
          renameLabel: "Rename watchlist",
          onSelect: () => undefined,
          onRename: () => undefined,
        }),
      ),
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain("min-h-10");
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('aria-label="Rename watchlist MAG7"');
    expect(html).toContain("size-10 min-h-10 min-w-10");
  });

  it("keeps a single watchlist tab with its count and hover-revealed rename", () => {
    const html = renderToStaticMarkup(
      React.createElement(StateTabs, {
        items: [{ id: 1, name: "Default" }],
        activeItem: { id: 1, name: "Default" },
        counts: new Map([[1, 1]]),
        readOnly: false,
        renameLabel: "Rename watchlist",
        onSelect: () => undefined,
        onRename: () => undefined,
      }),
    );

    expect(html).toContain('data-slot="list-tabs"');
    expect(html).toContain(">Default</span>");
    expect(html).toContain(">1</span>");
    expect(html).toContain('data-slot="list-tab-rename"');
    expect(html).toContain('aria-label="Rename watchlist Default"');
  });

  it("moves StateTabs with arrow keys using roving tabindex", () => {
    expect(nextStateTabIndex(0, 3, "ArrowRight")).toBe(1);
    expect(nextStateTabIndex(2, 3, "ArrowRight")).toBe(0);
    expect(nextStateTabIndex(0, 3, "ArrowLeft")).toBe(2);
    expect(nextStateTabIndex(1, 3, "Home")).toBe(0);
    expect(nextStateTabIndex(1, 3, "End")).toBe(2);
    expect(nextStateTabIndex(1, 3, "Enter")).toBe(1);
  });

  it("autofills new holding quantity, average cost, and currency from selected quote data", () => {
    expect(
      getHoldingAutofillValues({
        selectedSymbol: "ASTS",
        currentValues: { shares: "", avg_cost: "", currency: "USD" },
        selectedQuote: { status: "ok", price: 42.37, currency: "USD" },
      }),
    ).toEqual({ shares: "100", avg_cost: "42.37", currency: "USD" });
  });

  it("replaces the untouched USD default with the selected quote currency", () => {
    expect(
      getHoldingAutofillValues({
        selectedSymbol: "SHOP.TO",
        currentValues: { shares: "100", avg_cost: "", currency: "USD" },
        previousAutofill: { shares: "100", avg_cost: "", currency: "USD" },
        selectedQuote: { status: "ok", price: 154.2, currency: "CAD" },
      }),
    ).toEqual({ shares: "100", avg_cost: "154.2", currency: "CAD" });
  });

  it("does not invent USD when quote currency resolution fails", () => {
    expect(
      getHoldingAutofillValues({
        selectedSymbol: "SHOP.TO",
        currentValues: { shares: "", avg_cost: "", currency: "" },
        previousAutofill: { shares: "", avg_cost: "", currency: "" },
        selectedQuote: { status: "unavailable" },
      }),
    ).toEqual({ shares: "100", avg_cost: "", currency: "" });
  });

  it("does not overwrite holding fields the user has already edited", () => {
    expect(
      getHoldingAutofillValues({
        selectedSymbol: "ASTS",
        currentValues: { shares: "25", avg_cost: "40", currency: "CAD" },
        previousAutofill: { shares: "100", avg_cost: "42.37", currency: "USD" },
        selectedQuote: { status: "ok", price: 45, currency: "USD" },
      }),
    ).toEqual({ shares: "25", avg_cost: "40", currency: "CAD" });
  });

  it("renders a portfolio skeleton before the first state response", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "portfolios",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain('data-slot="portfolio-skeleton"');
    expect(html).not.toContain("No holdings yet");
    expect(html).not.toContain("Skip For Now");
  });

  it("uses the shared app shell chrome without duplicate section tabs", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "watchlists",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
        onOpenSidebar: () => undefined,
      }),
    );

    expect(html).toContain('aria-label="Open sidebar"');
    expect(html).not.toContain('aria-label="Market state sections"');
  });

  it("renders named watchlists as tabs with a new-watchlist action", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "watchlists",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("New Watchlist");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain("Default");
    expect(html).toContain("Add ticker");
    expect(html.match(/>Watchlists</g)).toHaveLength(1);
    expect(html).toContain('aria-label="Rename watchlist Default"');
    expect(html).not.toContain("To target");
    expect(html).not.toContain("Thesis");
  });

  it("renders named portfolios as tabs with create, rename, and add-holding actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "portfolios",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("New Portfolio");
    expect(html).toContain('role="tablist"');
    expect(html).toContain('role="tab"');
    expect(html).toContain("Default");
    expect(html).toContain("Add holding");
    expect(html.match(/>Portfolios</g)).toHaveLength(1);
    expect(html).toContain('aria-label="Rename portfolio Default"');
  });

  it("uses shared select chrome in the alert condition form", () => {
    const html = renderToStaticMarkup(
      React.createElement(AlertCreateForm, {
        disabled: false,
        invokeTool: () => true,
      }),
    );

    expect(html).toContain("appearance-none");
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("Condition");
  });

  it("opens the alert create form with a route-prefilled symbol", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "alerts",
        alertSymbol: "MSFT",
        role: "writer",
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Create Alert");
    expect(html).toContain('value="MSFT"');
    expect(html).toContain("Price threshold");
  });

  it("opens the alert create form on a level handed over in the route", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "alerts",
        alertSymbol: "MSFT",
        alertThreshold: "401.15",
        role: "writer",
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain('value="401.15"');
  });

  it("drops a route level the alert sheet could not save", () => {
    expect(alertThresholdFromLink("401.153")).toBe("401.15");
    expect(alertThresholdFromLink("0.0000073214")).toBe("0.0000073214");
    expect(alertThresholdFromLink("0")).toBeUndefined();
    expect(alertThresholdFromLink("-4")).toBeUndefined();
    expect(alertThresholdFromLink("not-a-price")).toBeUndefined();
    expect(alertThresholdFromLink(undefined)).toBeUndefined();
  });

  it("uses human cooldown choices and condition-specific alert field labels", () => {
    const html = renderToStaticMarkup(
      React.createElement(AlertCreateForm, {
        disabled: false,
        invokeTool: () => true,
        alert: {
          id: 1,
          conditionType: "price_crosses_above",
          conditionJson: { threshold: 80 },
          cooldownSeconds: 123,
        },
        symbol: "AAPL",
      }),
    );

    expect(html).toContain(">Price threshold<input");
    expect(html).toContain('placeholder="80.00"');
    expect(html).toContain(">Re-alert at most every<span");
    expect(html).toContain(">15 minutes<");
    expect(html).toContain(">1 hour<");
    expect(html).toContain(">4 hours<");
    expect(html).toContain(">1 day<");
    expect(html).toContain(">Custom (123s)<");

    expect(alertConditionFormFields("create_rsi_below")).toMatchObject({
      thresholdLabel: "RSI level (0–100)",
      thresholdPlaceholder: "30",
      period: { label: "RSI period (days)", min: 1, max: 100 },
    });
    expect(alertConditionFormFields("create_percent_move_up")).toMatchObject({
      thresholdLabel: "Move threshold (%)",
      thresholdPlaceholder: "3.0",
      threshold: { min: 0 },
    });
    expect(alertConditionFormFields("create_volume_spike")).toMatchObject({
      thresholdLabel: "Volume multiple (× average)",
      thresholdPlaceholder: "2.0",
      period: { label: "Average volume period (days)", min: 1, max: 100 },
    });
    expect(alertConditionFormFields("create_sma_cross_above")).toMatchObject({
      fastPeriod: { label: "Fast SMA period (days)", min: 1 },
      slowPeriod: { label: "Slow SMA period (days)", max: 400 },
    });

    const rsiFields = alertConditionFormFields("create_rsi_below");
    expect(
      isAlertDraftValid(
        { condition: "create_rsi_below", threshold: "101", period: "14" },
        rsiFields,
      ),
    ).toBe(false);
    const smaFields = alertConditionFormFields("create_sma_cross_above");
    expect(
      isAlertDraftValid(
        { condition: "create_sma_cross_above", fast_period: "50", slow_period: "50" },
        smaFields,
      ),
    ).toBe(false);
  });

  it("renders a focused watchlist rename form", () => {
    const html = renderToStaticMarkup(
      React.createElement(WatchlistRenameForm, {
        disabled: false,
        watchlist: { id: 1, name: "MAG7", isDefault: false },
        onSubmit: () => true,
      }),
    );

    expect(html).toContain("Name");
    expect(html).toContain('value="MAG7"');
    expect(html).toContain("Rename watchlist");
  });

  it("renders a focused portfolio rename form", () => {
    const html = renderToStaticMarkup(
      React.createElement(PortfolioRenameForm, {
        disabled: false,
        portfolio: { id: 1, name: "Trading", isDefault: false, baseCurrency: "USD" },
        onSubmit: () => true,
      }),
    );

    expect(html).toContain("Name");
    expect(html).toContain('value="Trading"');
    expect(html).toContain("Rename portfolio");
  });

  it("uses a currency select and preserves an existing nonstandard lot currency", () => {
    const html = renderToStaticMarkup(
      React.createElement(HoldingForm, {
        disabled: false,
        lot: { id: 4, symbol: "SHOP", quantity: 3, avgCost: 120, currency: "SEK" },
        onSubmit: () => true,
      }),
    );

    expect(html).toContain(">Currency<span");
    expect(html).toContain("<select");
    expect(html).toContain('<option value="USD">USD</option>');
    expect(html).toContain('<option value="JPY">JPY</option>');
    expect(html).toContain('<option value="SEK" selected="">SEK</option>');
  });

  it("keeps a pending portfolio submit button at its label width", () => {
    const html = renderToStaticMarkup(
      React.createElement(PendingSubmitButton, { pending: true }, "Save holding"),
    );

    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("invisible");
    expect(html).toContain("animate-spin");
  });

  it("renders the report schedule and generate action as durable report state", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "reports",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Generate today");
    expect(html).toContain("History");
  });

  it("refreshes quotes in the background instead of offering manual refresh buttons", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "watchlists",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).not.toContain("Refresh prices");
    expect(html).not.toContain(">Refresh<");
    expect(html).not.toContain("Awaiting quotes");
    expect(html).not.toContain("Updated ");
    expect(html).not.toContain(">stale<");
    expect(html).not.toContain("SQLite-backed");
    expect(html).not.toContain("Search Yahoo candidates before saving");
  });

  it("renders durable alert state as rules plus one activity feed", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "alerts",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Active rules");
    // A first-run page shows one empty state, not three empty card shells.
    expect(html).not.toContain("Activity");
    expect(html).not.toContain("Alert log");
    expect(html).not.toContain("Notifications");
    expect(html).not.toContain("Instrument #");
  });

  it("renders accessible icon actions and sentence-case badges for alert rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(AlertsPage, {
        state: {
          alerts: [
            {
              id: 1,
              scopeType: "instrument",
              instrumentId: 7,
              conditionType: "price_crosses_above",
              conditionJson: { threshold: 50, field: "last_price" },
              enabled: true,
              retriggerMode: "recurring",
            },
          ],
          alertEvents: [],
          alertCheckRuns: [],
          instruments: [{ id: 7, symbol: "RKLB" }],
          notifications: [],
          notificationDeliveryAttempts: [],
        },
        filter: "",
        setFilter: () => undefined,
        readOnly: false,
        openPanel: () => undefined,
        invokeTool: () => undefined,
      }),
    );

    expect(html).toContain("Repeats");
    expect(html).not.toContain(">recurring<");
    expect(html).toContain('aria-label="Pause RKLB alert"');
    expect(html).toContain('aria-label="Edit RKLB alert"');
    expect(html).toContain('aria-label="Delete RKLB alert"');
    expect(html).toContain("min-h-10");
    expect(html).toContain("hover:text-destructive");
    expect(html).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
    expect(html).toContain('data-slot="alert-rule-row"');
    // The action cluster rests invisible on pointer surfaces.
    expect(html).toContain("md:opacity-0");
  });

  it("reserves plus icons for create actions in alert and report headers", () => {
    const alertHtml = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "alerts",
        role: "writer",
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );
    const reportHtml = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "reports",
        role: "writer",
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(alertHtml).toContain("Create alert");
    expect(alertHtml).toContain("Check alerts");
    expect(alertHtml).toContain("lucide-refresh-cw");
    expect(alertHtml).not.toContain("lucide-plus");
    expect(reportHtml).toContain("Configure report");
    expect(reportHtml).toContain("lucide-settings");
    expect(reportHtml).not.toContain("lucide-plus");
  });

  it("runs the report directly from the hosted reports header instead of configuring", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RuntimeTransportProvider,
        { transport: { kind: "hosted" } as never },
        React.createElement(MarketStatePage, {
          domain: "reports",
          role: "writer",
          navigate: () => undefined,
          setToast: () => undefined,
        }),
      ),
    );

    expect(html).toContain("Run report");
    expect(html).not.toContain("Configure report");
  });

  it("replaces the hosted schedule line with the on-demand truth", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        RuntimeTransportProvider,
        { transport: { kind: "hosted" } as never },
        React.createElement(ReportsPage, {
          state: {
            reportTemplates: [],
            reportRuns: [],
            notifications: [],
            notificationDeliveryAttempts: [],
          },
          readOnly: false,
          invokeTool: () => undefined,
          timeZone: "UTC",
        }),
      ),
    );

    expect(html).toContain("Reports run when you ask for one");
    expect(html).not.toContain("No schedule configured");
  });

  it("renders reports as humanized rich text with collision-safe notifications", () => {
    const html = renderToStaticMarkup(
      React.createElement(ReportsPage, {
        state: {
          reportTemplates: [],
          reportRuns: [
            {
              id: 1,
              status: "completed",
              triggerType: "manual",
              startedAt: "2026-07-05T22:00:00.000Z",
              completedAt: "2026-07-05T22:05:31.730Z",
              summaryJson: {
                text: "**Daily Watchlist Report**\n\nGenerated at 2026-07-05T22:05:31.730Z\n\nTarget watchlist: Default",
              },
            },
          ],
          notifications: [
            {
              id: 2,
              sourceType: "report_run",
              status: "pending",
              createdAt: "2026-07-05T22:05:31.730Z",
              title: "Daily watchlist report completed with several market updates",
            },
          ],
          notificationDeliveryAttempts: [],
        },
        readOnly: false,
        invokeTool: () => undefined,
        timeZone: "UTC",
      }),
    );

    expect(html).toContain("<strong>Daily Watchlist Report</strong>");
    expect(html).not.toContain("**Daily Watchlist Report**");
    expect(html).not.toContain("2026-07-05T22:05:31.730Z");
    expect(html).not.toContain("Target watchlist: Default");
    expect(html).toContain("Target watchlist: My watchlist");
    expect(html).toContain("Jul 5, 10:05 PM");
    expect(html).toContain("Done");
    expect(html).toContain('data-slot="notification-message"');
    // One line per notification: title, then the date on the right. The
    // delivery channel was internal vocabulary and is gone.
    expect(html).toContain('data-slot="activity-date"');
    expect(html).not.toContain("in-app");
    expect(html).toContain("min-w-0");
    expect(html).toContain("shrink-0");
  });

  it("keeps reconnecting market-state pages readable while disabling mutation actions", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "alerts",
        role: "follower",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Saved-state changes are unavailable");
    expect(html).toContain("Create alert");
    expect(html).toContain("Check alerts");
    expect(html).toContain("disabled");
  });

  it("keeps connecting and disconnected market-state mutations unavailable", () => {
    for (const role of ["connecting", "disconnected"]) {
      const html = renderToStaticMarkup(
        React.createElement(MarketStatePage, {
          domain: "watchlists",
          role,
          send: () => false,
          navigate: () => undefined,
          setToast: () => undefined,
        }),
      );

      expect(html).toContain("Saved-state changes");
      expect(html).toContain("disabled");
    }
  });

  it("renders symbol search with combobox semantics", () => {
    const html = renderToStaticMarkup(
      React.createElement(SymbolSearchInput, {
        query: "AA",
        selected: "",
        disabled: false,
        onQueryChange: () => undefined,
        onSelectedChange: () => undefined,
      }),
    );

    expect(html).toContain('role="combobox"');
    expect(html).toContain('aria-autocomplete="list"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("aria-controls=");
  });

  it("derives combobox active index without prop-change state syncing", () => {
    expect(clampComboboxActiveIndex(3, 2)).toBe(1);
    expect(clampComboboxActiveIndex(-1, 2)).toBe(-1);
    expect(clampComboboxActiveIndex(0, 0)).toBe(-1);

    expect(nextComboboxActiveIndex(-1, 3, "next")).toBe(0);
    expect(nextComboboxActiveIndex(2, 3, "next")).toBe(0);
    expect(nextComboboxActiveIndex(-1, 3, "previous")).toBe(2);
    expect(nextComboboxActiveIndex(0, 3, "previous")).toBe(2);
  });

  it("accepts bounded exact symbols for hosted state forms when suggestions are unavailable", () => {
    expect(normalizeExactHostedSymbol(" aapl ")).toBe("AAPL");
    expect(normalizeExactHostedSymbol("BRK.B")).toBe("BRK.B");
    expect(normalizeExactHostedSymbol("BTC-USD")).toBe("BTC-USD");
    expect(normalizeExactHostedSymbol("ES=F")).toBe("ES=F");
    expect(normalizeExactHostedSymbol("A".repeat(32))).toBe("A".repeat(32));
    expect(normalizeExactHostedSymbol("A".repeat(33))).toBe("");
    expect(normalizeExactHostedSymbol("not a symbol")).toBe("");
    expect(normalizeExactHostedSymbol("../escape")).toBe("");
  });

  it("keeps holding forms out of the first viewport", () => {
    const html = renderToStaticMarkup(
      React.createElement(MarketStatePage, {
        domain: "portfolios",
        role: "writer",
        send: () => false,
        navigate: () => undefined,
        setToast: () => undefined,
      }),
    );

    expect(html).toContain("Add holding");
    expect(html).toContain("Portfolios");
    expect(html).not.toContain("Use the lot id shown in the portfolio table");
  });

  it("rejects market-state mutations without acknowledged invoke support", async () => {
    const setPendingMutationCalls = [];
    const toastCalls = [];
    const saved = await invokeMarketStateMutation({
      readOnly: false,
      toolName: "manage_watchlist",
      args: { action: "add", symbol: "AAPL" },
      setPendingMutation: (value) => setPendingMutationCalls.push(value),
      setToast: (message, options) => toastCalls.push({ message, options }),
      refresh: () => {
        throw new Error("unexpected refresh");
      },
    });

    expect(saved).toBe(false);
    expect(setPendingMutationCalls).toEqual([{ toolName: "manage_watchlist" }, null]);
    expect(toastCalls).toEqual([
      expect.objectContaining({
        message:
          "Market-state mutations require acknowledged tool invocation support. Reconnect the GUI and try again.",
      }),
    ]);
  });

  it("refreshes quotes immediately after acknowledged market-state mutations", async () => {
    const refresh = vi.fn();
    const refreshQuotes = vi.fn();
    const invokeToolRequest = vi.fn(async () => undefined);

    const saved = await invokeMarketStateMutation({
      readOnly: false,
      toolName: "manage_watchlist",
      args: { action: "add", symbol: "AAPL" },
      invokeToolRequest,
      refresh,
      refreshQuotes,
    });

    expect(saved).toBe(true);
    expect(invokeToolRequest).toHaveBeenCalledWith(
      "manage_watchlist",
      {
        action: "add",
        symbol: "AAPL",
      },
      "",
      { recordTranscript: false },
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshQuotes).toHaveBeenCalledOnce();
  });

  it("does not hold the saved-state acknowledgement open while quotes refresh", async () => {
    let resolveQuotes: (() => void) | undefined;
    const refreshQuotes = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveQuotes = resolve;
        }),
    );

    const saved = await invokeMarketStateMutation({
      readOnly: false,
      toolName: "manage_watchlist",
      args: { action: "add", symbol: "AAPL" },
      invokeToolRequest: vi.fn(async () => undefined),
      refresh: vi.fn(async () => undefined),
      refreshQuotes,
    });

    expect(saved).toBe(true);
    expect(refreshQuotes).toHaveBeenCalledOnce();
    resolveQuotes?.();
  });

  it("keeps a market-state form open when a tool requires more input", async () => {
    const refresh = vi.fn();
    const refreshQuotes = vi.fn();
    const setToast = vi.fn();
    const saved = await invokeMarketStateMutation({
      readOnly: false,
      toolName: "manage_watchlist",
      args: { action: "add", symbol: "SHOP" },
      invokeToolRequest: vi.fn(async () => ({
        content: [{ type: "text", text: "Choose a listing." }],
        details: { status: "needs_selection", query: "SHOP", candidates: [] },
      })),
      setToast,
      refresh,
      refreshQuotes,
    });

    expect(saved).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(refreshQuotes).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith("Choose a listing.", { destructive: true });
  });

  it("propagates the hosted exact-symbol verification state from alert forms", async () => {
    expect(alertInstrumentArgs("AAPL", true)).toEqual({
      symbol: "AAPL",
      unverified_exact_symbol: true,
    });
    expect(alertInstrumentArgs("AAPL", false)).toEqual({ symbol: "AAPL" });
    expect(holdingInstrumentArgs("AAPL", true)).toEqual({
      symbol: "AAPL",
      unverified_exact_symbol: true,
    });
    expect(holdingInstrumentArgs("AAPL", false)).toEqual({ symbol: "AAPL" });
  });

  it("unwraps an acknowledged tool result before handling semantic validation", async () => {
    const refresh = vi.fn();
    const setToast = vi.fn();
    const saved = await invokeMarketStateMutation({
      readOnly: false,
      toolName: "manage_watchlist",
      args: { action: "add", symbol: "SHOP" },
      invokeToolRequest: vi.fn(async () => ({
        type: "tool.invoke.result",
        ok: true,
        result: {
          toolCallId: "call-1",
          content: [{ type: "text", text: "Choose a listing." }],
          details: { status: "needs_selection", query: "SHOP", candidates: [] },
          isError: false,
        },
      })),
      setToast,
      refresh,
    });

    expect(saved).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
    expect(setToast).toHaveBeenCalledWith("Choose a listing.", { destructive: true });
  });

  it("names market-state form controls for assistive technology", () => {
    const alertHtml = renderToStaticMarkup(
      React.createElement(AlertCreateForm, {
        disabled: false,
        invokeTool: () => true,
        onSaved: () => undefined,
      }),
    );
    const symbolHtml = renderToStaticMarkup(
      React.createElement(SymbolActionPanel, {
        disabled: false,
        onSubmit: () => true,
      }),
    );
    const holdingHtml = renderToStaticMarkup(
      React.createElement(HoldingForm, {
        disabled: false,
        onSubmit: () => true,
      }),
    );

    expect(alertHtml).toContain(">Condition");
    expect(alertHtml).toContain("<select");
    expect(alertHtml).toContain(">Price threshold<input");
    // Period only renders for SMA/RSI/volume conditions; the default price-above
    // condition hides it instead of showing a disabled field.
    expect(alertHtml).not.toContain(">Period (days)<input");
    expect(alertHtml).toContain(">Re-alert at most every<span");
    expect(symbolHtml).toContain("Search ticker or company");
    expect(holdingHtml).toContain(">Quantity<input");
    expect(holdingHtml).toContain(">Average cost per share<input");
    expect(holdingHtml).toContain(">Currency<span");
    expect(holdingHtml).toContain("<select");
    expect(symbolHtml).not.toContain(">Target<input");
    expect(symbolHtml).not.toContain(">Thesis<textarea");
  });
});
