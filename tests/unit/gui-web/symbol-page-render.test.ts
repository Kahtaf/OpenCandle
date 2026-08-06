import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { assetDescriptor } from "../../../gui/web/src/features/symbol/asset-descriptor.js";
import * as symbolPageModule from "../../../gui/web/src/features/symbol/SymbolPage.jsx";
import { SymbolPageView } from "../../../gui/web/src/features/symbol/SymbolPage.jsx";
import {
  invokeSymbolMutation,
  levelAlertHref,
} from "../../../gui/web/src/features/symbol/symbol-actions.js";
import { analyzePromptsForSymbol } from "../../../gui/web/src/features/symbol/symbol-prompts.js";
import {
  AboutCard,
  AlertsCard,
  AnalyzePanel,
  KeyLevelsCard,
  KeyStats,
  PositionCard,
  SymbolHero,
  TrendCard,
  WatchlistMembership,
} from "../../../gui/web/src/features/symbol/symbol-sections.jsx";
import { deriveSymbolContext } from "../../../gui/web/src/features/symbol/use-symbol-data.js";

const STATE = {
  instruments: [
    { id: 7, symbol: "MSFT", name: "Microsoft" },
    { id: 8, symbol: "NVDA", name: "NVIDIA" },
  ],
  watchlists: [{ id: 1, name: "Default" }],
  watchlist: [
    { id: 11, watchlistId: 1, instrumentId: 7, symbol: "MSFT" },
    { id: 12, watchlistId: 1, instrumentId: 8, symbol: "NVDA" },
  ],
  portfolio: [
    {
      id: 21,
      portfolioId: 2,
      instrumentId: 7,
      symbol: "MSFT",
      quantity: 4,
      avgCost: 300,
      currency: "USD",
    },
    {
      id: 22,
      portfolioId: 2,
      instrumentId: 8,
      symbol: "NVDA",
      quantity: 2,
      avgCost: 100,
      currency: "USD",
    },
  ],
  alerts: [
    {
      id: 31,
      instrumentId: 7,
      conditionType: "price_crosses_above",
      conditionJson: { threshold: 450 },
      enabled: true,
    },
    {
      id: 32,
      instrumentId: 8,
      conditionType: "price_crosses_below",
      conditionJson: { threshold: 90 },
      enabled: true,
    },
  ],
  alertEvents: [],
  quoteSnapshot: {
    watchlistQuotes: [
      {
        itemId: 11,
        instrumentId: 7,
        symbol: "MSFT",
        status: "ok",
        price: 421,
        change: 3,
        changePercent: 0.72,
        currency: "USD",
      },
    ],
    portfolioQuotes: [
      {
        lotId: 21,
        status: "ok",
        includedInTotals: true,
        totalCost: 1200,
        marketValue: 1680,
        pnl: 480,
        allocationPercent: 75,
        currentPrice: 420,
      },
      {
        lotId: 22,
        status: "ok",
        includedInTotals: true,
        totalCost: 200,
        marketValue: 240,
        pnl: 40,
        allocationPercent: 25,
        currentPrice: 120,
      },
    ],
  },
};

const EQUITY_VIEW_MODEL = {
  currentPrice: 420.5,
  currency: "USD",
  dayRange: { low: 417.2, high: 423.8 },
  horizonReturns: [
    { key: "week", percent: 2.41 },
    { key: "month", percent: -3.06 },
    { key: "ytd", percent: 11.72 },
    { key: "year", percent: 24.5 },
    { key: "fromHigh52w", percent: -8.25 },
  ],
  keyLevels: [
    { key: "week52High", label: "52-week high", value: 468.35, distancePercent: 11.38 },
    { key: "week52Low", label: "52-week low", value: 344.77, distancePercent: -18.01 },
    { key: "sma20", label: "20-day average", value: 412.6, distancePercent: -1.88 },
    { key: "sma50", label: "50-day average", value: 401.15, distancePercent: -4.6 },
  ],
  trend: {
    rows: [
      {
        key: "sma20",
        label: "20-day average",
        period: 20,
        average: 412.6,
        state: "above",
        stateLabel: "Above",
        distancePercent: 1.92,
      },
      {
        key: "sma50",
        label: "50-day average",
        period: 50,
        average: 401.15,
        state: "above",
        stateLabel: "Above",
        distancePercent: 4.82,
      },
      {
        key: "sma200",
        label: "200-day average",
        period: 200,
        average: 430.9,
        state: "below",
        stateLabel: "Below",
        distancePercent: -2.41,
      },
    ],
    sentence:
      "Signals are mixed: price is above its 20 and 50 day averages and below its 200 day average.",
  },
  volume: { volume: 12_400_000, averageVolume: 15_500_000, multiple: 0.8 },
  volumeLabel: "12.4M · 0.8× avg",
  hasDailyHistory: true,
};

const EMPTY_VIEW_MODEL = {
  currentPrice: null,
  currency: null,
  dayRange: null,
  horizonReturns: [],
  keyLevels: [],
  trend: { rows: [], sentence: null },
  volume: null,
  volumeLabel: null,
  hasDailyHistory: false,
};

describe("symbol page", () => {
  it("derives only the requested symbol's position, alerts, and watchlist membership", () => {
    const result = deriveSymbolContext(STATE, "msft");

    expect(result.instrumentId).toBe(7);
    expect(result.positionRows).toHaveLength(1);
    expect(result.positionRows[0]).toMatchObject({ symbol: "MSFT", pnl: 480 });
    expect(result.alertRows).toHaveLength(1);
    expect(result.alertRows[0].sentence).toContain("$450.00");
    expect(result.memberships).toEqual([
      expect.objectContaining({ id: 11, symbol: "MSFT", watchlistName: "Default" }),
    ]);
    expect(result.stateQuote).toMatchObject({ symbol: "MSFT", price: 421 });
  });

  it("no longer exports the ticker-string asset heuristic", () => {
    expect("isNonEquitySymbol" in symbolPageModule).toBe(false);
  });

  it.each([
    [2.5, 0.6, "up", "+$2.50", "+0.60%"],
    [-3.25, -0.75, "down", "−$3.25", "−0.75%"],
  ])("renders a signed, icon-labeled %s hero change", (change, percent, direction, money, pct) => {
    const html = renderToStaticMarkup(
      React.createElement(SymbolHero, {
        ticker: "MSFT",
        descriptor: assetDescriptor("stock"),
        viewModel: EQUITY_VIEW_MODEL,
        overview: { status: "ok", name: "Microsoft Corporation", exchange: "NasdaqGS" },
        quote: {
          status: "ok",
          symbol: "MSFT",
          price: 420.5,
          change,
          changePercent: percent,
          currency: "USD",
          marketState: "REGULAR",
          fetchedAt: new Date().toISOString(),
        },
      }),
    );

    expect(html).toContain("<h1");
    expect(html).toContain('data-slot="panel-card"');
    expect(html).toContain('data-slot="panel-header"');
    expect(html.indexOf('data-slot="panel-header"')).toBeLessThan(
      html.indexOf('data-slot="symbol-price-row"'),
    );
    expect(html).toContain("Microsoft Corporation");
    expect(html).toContain("MSFT");
    expect(html).toContain("Stock");
    expect(html).toContain("NasdaqGS");
    expect(html).toContain("$420.50");
    expect(html).toContain("tabular-nums");
    expect(html).toContain(`Price moved ${direction}:`);
    expect(html).toContain(money);
    expect(html).toContain(pct);
    expect(html).toContain("USD");
    expect(html).toContain("Regular market");
    expect(html).not.toContain('data-slot="extended-hours-quote"');
  });

  it("reuses ExtendedHoursQuote for pre-market quotes", () => {
    const html = renderToStaticMarkup(
      React.createElement(SymbolHero, {
        ticker: "MSFT",
        descriptor: assetDescriptor("stock"),
        viewModel: EQUITY_VIEW_MODEL,
        overview: { status: "ok", name: "Microsoft Corporation" },
        quote: {
          status: "ok",
          symbol: "MSFT",
          price: 420.5,
          change: 2.5,
          changePercent: 0.6,
          currency: "USD",
          marketState: "PRE",
          extendedPrice: 421.25,
          extendedChange: 0.75,
          extendedChangePercent: 0.18,
        },
      }),
    );

    expect(html).toContain('data-slot="extended-hours-quote"');
    expect(html).toContain("Pre-market");
    expect(html).toContain('data-slot="symbol-session-line"');
    expect(html.indexOf('data-slot="symbol-session-line"')).toBeGreaterThan(
      html.indexOf('data-slot="symbol-price-row"'),
    );
    expect(html).not.toContain("Pre-market session");
  });

  it("renders the equity stat strip from the descriptor vocabulary and view model", () => {
    const html = renderToStaticMarkup(
      React.createElement(SymbolHero, {
        ticker: "MSFT",
        descriptor: assetDescriptor("stock"),
        viewModel: EQUITY_VIEW_MODEL,
        overview: { status: "ok", name: "Microsoft Corporation" },
        quote: okQuote("MSFT"),
      }),
    );

    expect(html).toContain('data-slot="symbol-hero-stats"');
    expect(html.match(/data-slot="symbol-stat"/g)).toHaveLength(7);
    for (const label of ["5D", "1M", "YTD", "1Y", "From 52-week high", "Day range", "Volume"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("+2.4%");
    expect(html).toContain("−3.1%");
    expect(html).toContain("−8.3%");
    expect(html).toContain("$417.20 – $423.80");
    expect(html).toContain("12.4M · 0.8× avg");
    expect(html).toContain("tabular-nums");
  });

  it("swaps crypto vocabulary and states continuous trading in the session line", () => {
    const html = renderToStaticMarkup(
      React.createElement(SymbolHero, {
        ticker: "BTC-USD",
        descriptor: assetDescriptor("crypto"),
        viewModel: EQUITY_VIEW_MODEL,
        overview: { status: "unavailable", reason: "no fundamentals" },
        quote: { ...okQuote("BTC-USD"), marketState: "CLOSED" },
      }),
    );

    expect(html).toContain("1W");
    expect(html).toContain("24h range");
    expect(html).not.toContain(">5D<");
    expect(html).not.toContain("Day range");
    expect(html).toContain("Trades 24/7");
    expect(html).not.toContain("Market closed");
  });

  it("omits horizons the history cannot support instead of showing zero or a dash", () => {
    const html = renderToStaticMarkup(
      React.createElement(SymbolHero, {
        ticker: "NEWCO",
        descriptor: assetDescriptor("stock"),
        viewModel: {
          ...EMPTY_VIEW_MODEL,
          currentPrice: 12.5,
          currency: "USD",
          horizonReturns: [{ key: "week", percent: 4.2 }],
        },
        overview: { status: "ok", name: "Newco" },
        quote: okQuote("NEWCO"),
      }),
    );

    expect(html).toContain("5D");
    expect(html).toContain("+4.2%");
    expect(html).not.toContain("YTD");
    expect(html).not.toContain("1Y");
    expect(html).not.toContain("From 52-week high");
    expect(html).not.toContain("Volume");
    expect(html).not.toContain("0.0%");
    expect(html).not.toContain("—");
  });

  it("renders hero skeletons shaped like the price block and stat strip", () => {
    const html = renderToStaticMarkup(
      React.createElement(SymbolHero, {
        ticker: "MSFT",
        descriptor: assetDescriptor("stock"),
        viewModel: EMPTY_VIEW_MODEL,
        overview: null,
        quote: null,
        quoteLoading: true,
        statsLoading: true,
      }),
    );

    expect(html).toContain('data-slot="symbol-hero-skeleton"');
    expect(html).toContain("Loading MSFT</span>");
    expect(html).toContain("motion-reduce:animate-none");
    expect(html.match(/data-slot="skeleton"/g)?.length).toBeGreaterThan(3);
  });

  it("prices key levels in the quote currency with a signed distance and an alert link", () => {
    const html = renderToStaticMarkup(
      React.createElement(KeyLevelsCard, {
        ticker: "MSFT",
        currency: "USD",
        levels: EQUITY_VIEW_MODEL.keyLevels,
        role: "writer",
      }),
    );

    expect(html).toContain('aria-label="Key levels"');
    expect(html).toContain("Calculated from recent price action.");
    expect(html).toContain("52-week high");
    expect(html).toContain("$468.35");
    expect(html).toContain("+11.4%");
    expect(html).toContain("50-day average");
    expect(html).toContain("$401.15");
    expect(html).toContain("−4.6%");
    expect(html).toContain('href="/alerts?alertSymbol=MSFT&amp;alertThreshold=401.15"');
    expect(html).toContain("Create alert at the 50-day average");
    expect(html).toContain("tabular-nums");
  });

  it("prices key levels in a non-dollar quote currency", () => {
    const html = renderToStaticMarkup(
      React.createElement(KeyLevelsCard, {
        ticker: "SAP.DE",
        currency: "EUR",
        levels: [{ key: "sma20", label: "20-day average", value: 168.64, distancePercent: -2.1 }],
        role: "writer",
      }),
    );

    expect(html).toContain("EUR 168.64");
    expect(html).not.toContain("$168.64");
  });

  it("prices nothing in dollars while the quote currency is unknown", () => {
    const levels = renderToStaticMarkup(
      React.createElement(KeyLevelsCard, {
        ticker: "SAP.DE",
        levels: [{ key: "sma20", label: "20-day average", value: 168.64, distancePercent: -2.1 }],
        role: "writer",
      }),
    );
    expect(levels).toContain("168.64");
    expect(levels).not.toContain("$168.64");

    const hero = renderToStaticMarkup(
      React.createElement(SymbolHero, {
        ticker: "SAP.DE",
        descriptor: assetDescriptor("stock"),
        viewModel: EQUITY_VIEW_MODEL,
        overview: { status: "ok", name: "SAP SE" },
        quote: { status: "unavailable", reason: "provider unavailable" },
      }),
    );
    expect(hero).toContain("417.20 – 423.80");
    expect(hero).not.toContain("$417.20");
    expect(hero).not.toContain(">USD<");
  });

  it("omits the key levels card entirely when no level is computable", () => {
    expect(
      renderToStaticMarkup(
        React.createElement(KeyLevelsCard, { ticker: "MSFT", currency: "USD", levels: [] }),
      ),
    ).toBe("");
  });

  it("disables level alert creation in a follower window", () => {
    const html = renderToStaticMarkup(
      React.createElement(KeyLevelsCard, {
        ticker: "MSFT",
        currency: "USD",
        levels: EQUITY_VIEW_MODEL.keyLevels,
        role: "follower",
      }),
    );

    expect(html).toContain('disabled=""');
    expect(html).not.toContain('href="/alerts?alertSymbol=MSFT');
    expect(html).toContain("Available in the writer window.");
  });

  it("builds a level alert href on the alert sheet's own threshold formatting", () => {
    expect(levelAlertHref("msft", 401.153)).toBe("/alerts?alertSymbol=MSFT&alertThreshold=401.15");
    expect(levelAlertHref("PEPE-USD", 0.0000073214)).toBe(
      "/alerts?alertSymbol=PEPE-USD&alertThreshold=0.0000073214",
    );
    expect(levelAlertHref("MSFT", 0)).toBe(null);
    expect(levelAlertHref("", 12)).toBe(null);
  });

  it("labels each trend horizon and states one summary sentence", () => {
    const html = renderToStaticMarkup(
      React.createElement(TrendCard, { trend: EQUITY_VIEW_MODEL.trend, currency: "USD" }),
    );

    expect(html).toContain('aria-label="Trend summary"');
    expect(html).toContain("20-day average");
    expect(html).toContain("Above");
    expect(html).toContain("200-day average");
    expect(html).toContain("Below");
    expect(html).toContain(EQUITY_VIEW_MODEL.trend.sentence);
  });

  it("omits the trend card when no horizon is computable", () => {
    expect(
      renderToStaticMarkup(React.createElement(TrendCard, { trend: { rows: [], sentence: null } })),
    ).toBe("");
  });

  it("states on every derived card that the history behind it is not current", () => {
    const note = "Price history as of Aug 1";
    const levels = renderToStaticMarkup(
      React.createElement(KeyLevelsCard, {
        ticker: "MSFT",
        currency: "USD",
        levels: EQUITY_VIEW_MODEL.keyLevels,
        basisNote: note,
      }),
    );
    const trend = renderToStaticMarkup(
      React.createElement(TrendCard, { trend: EQUITY_VIEW_MODEL.trend, basisNote: note }),
    );
    const hero = renderToStaticMarkup(
      React.createElement(SymbolHero, {
        ticker: "MSFT",
        descriptor: assetDescriptor("stock"),
        viewModel: EQUITY_VIEW_MODEL,
        overview: { status: "ok", name: "Microsoft Corporation" },
        quote: okQuote("MSFT"),
        basisNote: note,
      }),
    );

    for (const html of [levels, trend, hero]) {
      expect(html).toContain('data-slot="symbol-history-basis-note"');
      expect(html).toContain(note);
    }
    // The card still says where its levels come from; the freshness line is
    // added to that, not swapped in for it.
    expect(levels).toContain("Calculated from recent price action.");
  });

  it("says nothing about history freshness while the history is current", () => {
    const html = renderToStaticMarkup(
      React.createElement(KeyLevelsCard, {
        ticker: "MSFT",
        currency: "USD",
        levels: EQUITY_VIEW_MODEL.keyLevels,
      }),
    );
    expect(html).not.toContain('data-slot="symbol-history-basis-note"');
  });

  it("discloses stale derived history across the page's derived surfaces", () => {
    const html = renderToStaticMarkup(
      React.createElement(SymbolPageView, {
        ticker: "MSFT",
        data: okSymbolData("MSFT", {
          viewModel: {
            ...EQUITY_VIEW_MODEL,
            historyStale: true,
            historyAsOf: new Date().toISOString(),
          },
        }),
        range: "1M",
        onRangeChange: vi.fn(),
        ChartComponent: () => null,
      }),
    );

    expect(html).toContain('data-slot="symbol-history-basis-note"');
    expect(html).toContain("Price history as of");
  });

  it("renders available key stats as a divided definition list and omits provider placeholders", () => {
    const html = renderToStaticMarkup(
      React.createElement(KeyStats, {
        currency: "USD",
        overview: {
          status: "ok",
          marketCap: 0,
          pe: null,
          forwardPe: 28.4,
          eps: 12.34,
          dividendYield: 0.0044,
          beta: 0.91,
          avgVolume: 55_000_000,
          profitMargin: 0.24,
          revenueGrowth: 0.05,
          week52High: 468.35,
          week52Low: 344.77,
        },
      }),
    );

    expect(html).toContain("<dl");
    expect(html).toContain("<dt");
    expect(html).toContain("<dd");
    expect(html).toContain("border-b");
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("Forward P/E");
    expect(html).toContain("28.4");
    expect(html).not.toContain("Market cap");
    expect(html).not.toContain("Trailing P/E");
    expect(html).not.toContain("$0.00");
    // Key levels owns the 52-week range and derives it from fetched bars, so
    // repeating a second figure under the same label here would contradict it.
    expect(html).not.toContain("52-week high");
    expect(html).not.toContain("52-week low");
    expect(html).not.toContain("468.35");
  });

  it("omits the key-stats grid when overview data is unavailable", () => {
    expect(
      renderToStaticMarkup(
        React.createElement(KeyStats, {
          overview: { status: "unavailable", reason: "No company overview" },
        }),
      ),
    ).toBe("");
  });

  it("formats market cap in the instrument currency", () => {
    const html = renderToStaticMarkup(
      React.createElement(KeyStats, {
        currency: "CAD",
        overview: { status: "ok", marketCap: 3_000_000_000 },
      }),
    );

    expect(html).toContain("CAD 3.00B");
    expect(html).not.toContain("$3.00B");
  });

  it("renders the about card from the company profile and omits it without one", () => {
    const html = renderToStaticMarkup(
      React.createElement(AboutCard, {
        overview: {
          status: "ok",
          description: "Microsoft develops and supports software and services.",
          sector: "Technology",
          industry: "Software",
          exchange: "NasdaqGS",
        },
      }),
    );

    expect(html).toContain('aria-label="About"');
    expect(html).toContain("Microsoft develops and supports software and services.");
    expect(html).toContain("Technology");
    expect(html).toContain("Software");
    expect(
      renderToStaticMarkup(
        React.createElement(AboutCard, { overview: { status: "ok", description: "" } }),
      ),
    ).toBe("");
  });

  it("renders populated position, alert, and watchlist context with tabular P&L", () => {
    const context = deriveSymbolContext(STATE, "MSFT");
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(PositionCard, {
          ticker: "MSFT",
          positionRows: context.positionRows,
        }),
        React.createElement(AlertsCard, { ticker: "MSFT", alertRows: context.alertRows }),
        React.createElement(WatchlistMembership, {
          ticker: "MSFT",
          memberships: context.memberships,
          role: "writer",
          onAdd: vi.fn(),
        }),
      ),
    );

    expect(html).toContain("Market value");
    expect(html).toContain("4 shares");
    expect(html).toContain("$1,680.00");
    expect(html).toContain("+$480.00 (+40.0%)");
    expect(html).toContain("Share of portfolio");
    expect(html).toContain("75.0%");
    expect(html).toContain("tabular-nums");
    expect(html).toContain("Price crosses above $450.00");
    expect(html).toContain("Default");
  });

  it("keeps an unconvertible holding honest instead of implying a share of a total", () => {
    const html = renderToStaticMarkup(
      React.createElement(PositionCard, {
        ticker: "SAP.DE",
        positionRows: [
          {
            symbol: "SAP.DE",
            currency: "EUR",
            totalQuantity: 10,
            blendedCost: 150,
            marketValue: 1686.4,
            pnl: 186.4,
            pnlPercent: 12.4,
            allocationPercent: null,
            excludedFromTotals: true,
            exclusionReason: "Kept out of the portfolio total: EUR is not the base currency.",
            lots: [{ portfolioId: 2 }],
          },
        ],
      }),
    );

    expect(html).toContain("EUR 1,686.40");
    expect(html).toContain("Kept out of the portfolio total");
    expect(html).not.toContain("Share of portfolio");
  });

  it("does not add up one symbol's share across two portfolios", () => {
    const html = renderToStaticMarkup(
      React.createElement(PositionCard, {
        ticker: "MSFT",
        positionRows: [
          {
            symbol: "MSFT",
            currency: "USD",
            totalQuantity: 6,
            blendedCost: 300,
            marketValue: 2520,
            pnl: 720,
            pnlPercent: 40,
            allocationPercent: 120,
            lots: [{ portfolioId: 2 }, { portfolioId: 3 }],
          },
        ],
      }),
    );

    expect(html).toContain("$2,520.00");
    expect(html).not.toContain("Share of portfolio");
    expect(html).not.toContain("120.0%");
  });

  it("links alert creation to the threshold form and disables it without a quote", () => {
    const linked = renderToStaticMarkup(
      React.createElement(AlertsCard, {
        ticker: "MSFT",
        alertRows: [],
        createAlertHref: "/alerts?alertSymbol=MSFT",
      }),
    );
    const disabled = renderToStaticMarkup(
      React.createElement(AlertsCard, {
        ticker: "MSFT",
        alertRows: [],
        createAlertHref: null,
      }),
    );

    expect(linked).toContain('href="/alerts?alertSymbol=MSFT"');
    expect(linked).not.toContain('disabled=""');
    expect(disabled).toContain('disabled=""');
  });

  it("renders saved-context empty states and a writer add-to-watchlist affordance", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(PositionCard, { ticker: "MSFT", positionRows: [] }),
        React.createElement(AlertsCard, {
          ticker: "MSFT",
          alertRows: [],
          createAlertHref: "/alerts?alertSymbol=MSFT",
        }),
        React.createElement(WatchlistMembership, {
          ticker: "MSFT",
          memberships: [],
          role: "writer",
          onAdd: vi.fn(),
        }),
      ),
    );

    expect(html).toContain("MSFT is not held.");
    expect(html).not.toContain("<table");
    expect(html).not.toContain("Market value");
    expect(html).toContain("No alerts for MSFT yet");
    expect(html).toContain("Add to watchlist");
    expect(html).not.toContain('disabled=""');
  });

  it("templates action chips and prefills the composer without sending", () => {
    expect(analyzePromptsForSymbol("nvda")).toEqual([
      ["Deep research (takes a few minutes)", "/analyze $NVDA"],
      ["Options chain", "Show options chain for $NVDA"],
      ["Compare with another asset", "Compare $NVDA with "],
      ["Alert me if it drops 10% in a week", "Alert me if $NVDA drops 10% in a week"],
    ]);
    const fillComposer = vi.fn();
    const tree = AnalyzePanel({ ticker: "NVDA", role: "writer", fillComposer });
    const chip = findElementWithText(tree, "Deep research (takes a few minutes)");

    chip.props.onClick();
    expect(fillComposer).toHaveBeenCalledWith("/analyze $NVDA");
  });

  it("keeps follower analysis and mutation labels visible but disabled with neutral copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(AnalyzePanel, {
          ticker: "NVDA",
          role: "follower",
          fillComposer: vi.fn(),
        }),
        React.createElement(AlertsCard, {
          ticker: "NVDA",
          role: "follower",
          alertRows: [],
          createAlertHref: "/alerts?alertSymbol=NVDA",
        }),
        React.createElement(WatchlistMembership, {
          ticker: "NVDA",
          role: "follower",
          memberships: [],
          onAdd: vi.fn(),
        }),
      ),
    );

    expect(html).toContain("Options chain");
    expect(html).toContain("Deep research");
    expect(html).toContain("Create alert");
    expect(html).toContain("Add to watchlist");
    expect(html.match(/disabled=""/g)?.length).toBe(6);
    expect(html).toContain("Available in the writer window");
    expect(html).toContain("min-h-10");
    expect(html).toContain("active:scale-[0.96]");
    expect(html).toContain("transition-[background-color,color,box-shadow,transform,scale]");
    expect(html).not.toContain("transition-all");
  });

  it("refreshes symbol context only after an acknowledged market-state mutation", async () => {
    const invokeTool = vi.fn(async () => undefined);
    const refresh = vi.fn(async () => undefined);
    const refreshQuotes = vi.fn(async () => undefined);
    const saved = await invokeSymbolMutation({
      role: "writer",
      toolName: "manage_watchlist",
      args: { action: "add", symbol: "NVDA" },
      invokeTool,
      refresh,
      refreshQuotes,
    });

    expect(saved).toBe(true);
    expect(invokeTool).toHaveBeenCalledWith(
      "manage_watchlist",
      { action: "add", symbol: "NVDA" },
      "",
      { recordTranscript: false },
    );
    expect(refresh).toHaveBeenCalledOnce();
    expect(refreshQuotes).toHaveBeenCalledOnce();
  });

  it("fills the desktop canvas with a primary column beside a fixed detail rail", () => {
    const html = renderSymbolPage({
      ticker: "MSFT",
      data: { ...okSymbolData("MSFT"), ...deriveSymbolContext(STATE, "MSFT") },
    });

    expect(html).toContain('data-slot="detail-rail-layout"');
    expect(html).toContain('data-slot="detail-rail"');
    expect(html).not.toContain("max-w-[1120px]");
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  it("stacks hero, chart, position, key levels, stats, and about below the rail breakpoint", () => {
    const html = renderSymbolPage({
      ticker: "MSFT",
      data: { ...okSymbolData("MSFT"), ...deriveSymbolContext(STATE, "MSFT") },
    });
    const stacked = html.slice(0, html.indexOf('data-slot="detail-rail"'));
    const labels = ["Symbol quote", "Price chart", "Position", "Key levels", "Key stats", "About"];
    const indices = labels.map((label) => stacked.indexOf(`aria-label="${label}"`));

    for (const index of indices) expect(index).toBeGreaterThan(-1);
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(html.match(/<main[^>]*overflow-x-auto/g)).toBeNull();
    expect(html).not.toContain("min-w-[560px]");
  });

  it("keeps the rail cards out of the flow below the rail breakpoint", () => {
    const html = renderSymbolPage({
      ticker: "MSFT",
      data: { ...okSymbolData("MSFT"), ...deriveSymbolContext(STATE, "MSFT") },
    });
    const rail = html.slice(html.indexOf('data-slot="detail-rail"'));

    for (const label of ["Key levels", "Trend summary", "Position", "Alerts", "Analyze"]) {
      expect(rail).toContain(`aria-label="${label}"`);
    }
    expect(html.match(/data-slot="symbol-stacked-rail"/g)).toHaveLength(2);
    expect(html).toContain('data-slot="symbol-stacked-rail" class="xl:hidden');
  });

  it("omits equity-only sections for a crypto instrument instead of emptying them", () => {
    const html = renderSymbolPage({
      ticker: "BTC-USD",
      data: {
        ...okSymbolData("BTC-USD", { overview: { status: "unavailable", reason: "N/A" } }),
        descriptor: assetDescriptor("crypto"),
      },
    });

    expect(html).toContain('data-slot="test-chart"');
    expect(html).not.toContain('aria-label="Key stats"');
    expect(html).not.toContain('aria-label="About"');
    expect(html).toContain("Fundamental stats are not available for crypto assets.");
    expect(html).toContain('aria-label="Position"');
    expect(html).toContain('aria-label="Key levels"');
  });

  it("says so when a stock's fundamentals are unavailable instead of dropping the sections", () => {
    const html = renderSymbolPage({
      ticker: "MSFT",
      data: {
        ...okSymbolData("MSFT", {
          overview: { symbol: "MSFT", status: "unavailable", reason: "provider rate limited" },
        }),
      },
    });

    expect(html).not.toContain('aria-label="Key stats"');
    expect(html).not.toContain('aria-label="About"');
    expect(html).toContain("Company fundamentals are not available for MSFT right now.");
  });

  it("keeps an unresolved instrument to quote, chart, and saved context", () => {
    const html = renderSymbolPage({
      ticker: "ZZ=F",
      data: {
        ...okSymbolData("ZZ=F", { overview: { status: "unavailable", reason: "N/A" } }),
        descriptor: assetDescriptor("unknown"),
      },
    });

    expect(html).toContain('data-slot="test-chart"');
    expect(html).toContain("Further detail is not available for this instrument.");
    expect(html).not.toContain('aria-label="Key stats"');
    expect(html).not.toContain('aria-label="Key levels"');
    expect(html).not.toContain('aria-label="Trend summary"');
    expect(html).not.toContain('aria-label="Analyze"');
    expect(html).toContain('aria-label="Position"');
    expect(html).toContain('aria-label="Alerts"');
    expect(html).toContain('aria-label="Watchlist membership"');
  });

  it("renders a named not-found state when quote and overview are unavailable", () => {
    const html = renderSymbolPage({
      ticker: "ZZZZZZ",
      data: {
        ...okSymbolData("ZZZZZZ"),
        quote: { symbol: "ZZZZZZ", status: "unavailable", reason: "Unknown symbol" },
        overview: { symbol: "ZZZZZZ", status: "unavailable", reason: "Unknown symbol" },
      },
    });

    expect(html).toContain("ZZZZZZ was not found");
    expect(html).not.toContain('data-slot="test-chart"');
    expect(html).toContain("<main");
  });

  it("recognizes Yahoo's no-fundamentals reason as an unknown symbol", () => {
    const html = renderSymbolPage({
      ticker: "ZZZZZZ",
      data: {
        ...okSymbolData("ZZZZZZ"),
        quote: {
          symbol: "ZZZZZZ",
          status: "unavailable",
          reason: "Invalid symbol ZZZZZZ for yahoo",
        },
        overview: {
          symbol: "ZZZZZZ",
          status: "unavailable",
          reason: "Yahoo Finance: no company fundamentals returned for ZZZZZZ",
        },
      },
    });

    expect(html).toContain("ZZZZZZ was not found");
  });

  it("shows generic provider unavailability as an error instead of not-found", () => {
    const html = renderSymbolPage({
      ticker: "AAPL",
      data: {
        ...okSymbolData("AAPL"),
        quote: { symbol: "AAPL", status: "unavailable", reason: "provider rate limited" },
        overview: { symbol: "AAPL", status: "unavailable", reason: "network unavailable" },
        error: "Market data providers are unavailable",
      },
    });

    expect(html).not.toContain("AAPL was not found");
    expect(html).toContain("Market data providers are unavailable");
    expect(html).toContain('data-slot="test-chart"');
  });

  it("renders stable hero, chart, and stats skeleton blocks on initial load", () => {
    const html = renderSymbolPage({
      ticker: "MSFT",
      data: {
        ...okSymbolData("MSFT"),
        quote: null,
        overview: null,
        history: null,
        quoteLoading: true,
        overviewLoading: true,
        historyLoading: true,
        viewModel: EMPTY_VIEW_MODEL,
        viewModelLoading: true,
      },
    });

    expect(html).toContain('data-slot="symbol-hero-skeleton"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain("Loading MSFT</span>");
    expect(html).toContain('data-slot="symbol-chart-skeleton"');
    expect(html).toContain('data-slot="symbol-stats-skeleton"');
    expect(html).toContain('data-slot="symbol-levels-skeleton"');
    // Every rail card that will appear reserves its space, so the rail does not
    // jump when the derived math lands.
    expect(html).toContain('data-slot="symbol-trend-skeleton"');
    expect(html).toContain("motion-reduce:animate-none");
    expect(html).not.toContain("animate-in");
    expect(html).not.toContain("fade-in");
  });

  it("uses the existing degraded quote badge and price-flash class without fresh quote chrome", () => {
    const fresh = renderToStaticMarkup(
      React.createElement(SymbolHero, {
        ticker: "MSFT",
        descriptor: assetDescriptor("stock"),
        viewModel: EQUITY_VIEW_MODEL,
        overview: { status: "ok", name: "Microsoft" },
        quote: okSymbolData("MSFT").quote,
        flashClass: "transition-colors bg-success/[0.08]",
      }),
    );
    const stale = renderToStaticMarkup(
      React.createElement(SymbolHero, {
        ticker: "MSFT",
        descriptor: assetDescriptor("stock"),
        viewModel: EQUITY_VIEW_MODEL,
        overview: { status: "ok", name: "Microsoft" },
        quote: {
          ...okSymbolData("MSFT").quote,
          fetchedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        },
      }),
    );

    expect(fresh).toContain("transition-colors bg-success/[0.08]");
    expect(fresh).not.toMatch(/Quotes \d+m old/);
    expect(stale).toContain("Quotes 20m old");
  });

  it("keeps every user-visible symbol string free of em dashes", () => {
    const html = renderSymbolPage({
      ticker: "MSFT",
      data: { ...okSymbolData("MSFT"), ...deriveSymbolContext(STATE, "MSFT") },
    });

    expect(html).not.toContain("—");
    expect(html).not.toContain("&mdash;");
  });
});

function renderSymbolPage({ ticker, data }) {
  return renderToStaticMarkup(
    React.createElement(SymbolPageView, {
      ticker,
      data,
      range: "1M",
      onRangeChange: vi.fn(),
      role: "writer",
      fillComposer: vi.fn(),
      ChartComponent: TestChart,
    }),
  );
}

function TestChart({ range }) {
  return React.createElement("div", { "data-slot": "test-chart" }, `Chart ${range}`);
}

function okQuote(ticker) {
  return {
    symbol: ticker,
    status: "ok",
    name: ticker === "MSFT" ? "Microsoft Corporation" : ticker,
    price: 420.5,
    change: 2.5,
    changePercent: 0.6,
    currency: "USD",
    marketState: "REGULAR",
    previousClose: 418,
    fetchedAt: new Date().toISOString(),
  };
}

function okSymbolData(ticker, overrides = {}) {
  return {
    symbol: ticker,
    quote: okQuote(ticker),
    overview: {
      symbol: ticker,
      status: "ok",
      name: ticker === "MSFT" ? "Microsoft Corporation" : ticker,
      description: "A company that makes things.",
      exchange: "NasdaqGS",
      sector: "Technology",
      industry: "Software",
      marketCap: 3_100_000_000_000,
      pe: 36.5,
      forwardPe: 28.4,
      eps: 12.34,
      avgVolume: 22_000_000,
    },
    history: {
      symbol: ticker,
      range: "1M",
      bars: [{ time: 1_784_204_100, open: 418, high: 422, low: 417, close: 420.5 }],
    },
    descriptor: assetDescriptor("stock"),
    viewModel: EQUITY_VIEW_MODEL,
    derivedHistory: null,
    instrument: null,
    positionRows: [],
    alertRows: [],
    memberships: [],
    quoteLoading: false,
    overviewLoading: false,
    historyLoading: false,
    viewModelLoading: false,
    assetTypeLoading: false,
    refresh: vi.fn(),
    refreshQuotes: vi.fn(),
    ...overrides,
  };
}

function findElementWithText(node, text) {
  if (!node || typeof node !== "object") return null;
  if (node.props?.children === text) return node;
  const children = React.Children.toArray(node.props?.children);
  for (const child of children) {
    const match = findElementWithText(child, text);
    if (match) return match;
  }
  return null;
}
