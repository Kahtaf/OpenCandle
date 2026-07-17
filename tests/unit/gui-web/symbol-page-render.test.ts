import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SymbolPageView } from "../../../gui/web/src/features/symbol/SymbolPage.jsx";
import { invokeSymbolMutation } from "../../../gui/web/src/features/symbol/symbol-actions.js";
import { analyzePromptsForSymbol } from "../../../gui/web/src/features/symbol/symbol-prompts.js";
import {
  AlertsCard,
  AnalyzePanel,
  KeyStats,
  PositionCard,
  SymbolHeader,
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

  it.each([
    [2.5, 0.6, "up", "+$2.50", "+0.60%"],
    [-3.25, -0.75, "down", "−$3.25", "−0.75%"],
  ])("renders a signed, icon-labeled %s header change", (change, percent, direction, money, pct) => {
    const html = renderToStaticMarkup(
      React.createElement(SymbolHeader, {
        ticker: "MSFT",
        overview: { status: "ok", name: "Microsoft Corporation" },
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
    expect(html).toContain("text-balance");
    expect(html).toContain("Microsoft Corporation");
    expect(html).toContain("MSFT");
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
      React.createElement(SymbolHeader, {
        ticker: "MSFT",
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
    expect(html).toContain("md:grid-cols-2");
    expect(html).toContain("xl:grid-cols-3");
    expect(html).toContain("border-b");
    expect(html).toContain("text-muted-foreground");
    expect(html).toContain("text-right tabular-nums");
    expect(html).toContain("Forward P/E");
    expect(html).toContain("28.4");
    expect(html).not.toContain("Market cap");
    expect(html).not.toContain("Trailing P/E");
    expect(html).not.toContain("$0.00");
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

    expect(html).toContain("4 shares");
    expect(html).toContain("$1,680.00");
    expect(html).toContain("+$480.00 (+40.0%)");
    expect(html).toContain("tabular-nums");
    expect(html).toContain("Price crosses above $450.00");
    expect(html).toContain("Default");
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

    expect(html).toContain("No saved position in MSFT");
    expect(html).toContain("No alerts for MSFT yet");
    expect(html).toContain("Add to watchlist");
    expect(html).not.toContain('disabled=""');
  });

  it("templates analyze chips and dispatches a writer click through startChatRun", () => {
    expect(analyzePromptsForSymbol("nvda")).toEqual([
      ["What is NVDA trading at?", "What is NVDA trading at?"],
      ["Options chain for NVDA", "Show options chain for NVDA"],
      ["Deep research: NVDA (multi-analyst, takes a few minutes)", "/analyze NVDA"],
    ]);
    const startChatRun = vi.fn();
    const tree = AnalyzePanel({ ticker: "NVDA", role: "writer", startChatRun });
    const chip = findElementWithText(
      tree,
      "Deep research: NVDA (multi-analyst, takes a few minutes)",
    );

    chip.props.onClick();
    expect(startChatRun).toHaveBeenCalledWith("/analyze NVDA");
  });

  it("keeps follower analysis and mutation labels visible but disabled with neutral copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        React.Fragment,
        null,
        React.createElement(AnalyzePanel, {
          ticker: "NVDA",
          role: "follower",
          startChatRun: vi.fn(),
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

    expect(html).toContain("What is NVDA trading at?");
    expect(html).toContain("Options chain for NVDA");
    expect(html).toContain("Deep research: NVDA");
    expect(html).toContain("Create alert");
    expect(html).toContain("Add to watchlist");
    expect(html.match(/disabled=""/g)?.length).toBe(5);
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

  it.each([
    ["BTC-USD", "Fundamental stats aren&#x27;t available for crypto assets."],
    ["^GSPC", "Fundamental stats aren&#x27;t available for market indices."],
  ])("renders %s with an explicit limited-data note", (ticker, note) => {
    const html = renderSymbolPage({
      ticker,
      data: okSymbolData(ticker, { overview: { status: "unavailable", reason: "N/A" } }),
    });

    expect(html).toContain(ticker);
    expect(html).toContain('data-slot="test-chart"');
    expect(html).not.toContain('aria-label="Key stats"');
    expect(html).toContain('aria-label="Fundamental data availability"');
    expect(html).toContain(note);
    expect(html).not.toContain('aria-label="Position"');
    expect(html).not.toContain('aria-label="Analyze"');
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

  it("assembles one-main, one-heading equity sections in the fixed order", () => {
    const context = deriveSymbolContext(STATE, "MSFT");
    const html = renderSymbolPage({
      ticker: "MSFT",
      data: { ...okSymbolData("MSFT"), ...context },
    });

    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html.match(/<h1/g)).toHaveLength(1);
    const labels = ["Symbol quote", "Price chart", "Key stats", "Position", "Alerts", "Analyze"];
    for (const label of labels) expect(html).toContain(`aria-label="${label}"`);
    const indices = labels.map((label) => html.indexOf(`aria-label="${label}"`));
    expect(indices).toEqual([...indices].sort((a, b) => a - b));
    expect(html).toContain('aria-label="Watchlist membership"');
    expect(html).not.toContain("min-w-[560px]");
    expect(html.match(/<main[^>]*overflow-x-auto/g)).toBeNull();
  });

  it("renders stable header, chart, and stats skeleton blocks on initial load", () => {
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
      },
    });

    expect(html).toContain('data-slot="symbol-header-skeleton"');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain("Loading MSFT</h1>");
    expect(html).toContain('data-slot="symbol-chart-skeleton"');
    expect(html).toContain('data-slot="symbol-stats-skeleton"');
    expect(html).not.toContain("animate-in");
    expect(html).not.toContain("fade-in");
  });

  it("uses the existing degraded quote badge and price-flash class without fresh quote chrome", () => {
    const fresh = renderToStaticMarkup(
      React.createElement(SymbolHeader, {
        ticker: "MSFT",
        overview: { status: "ok", name: "Microsoft" },
        quote: okSymbolData("MSFT").quote,
        flashClass: "transition-colors bg-success/[0.08]",
      }),
    );
    const stale = renderToStaticMarkup(
      React.createElement(SymbolHeader, {
        ticker: "MSFT",
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
});

function renderSymbolPage({ ticker, data }) {
  return renderToStaticMarkup(
    React.createElement(SymbolPageView, {
      ticker,
      data,
      range: "1M",
      onRangeChange: vi.fn(),
      role: "writer",
      startChatRun: vi.fn(),
      ChartComponent: TestChart,
    }),
  );
}

function TestChart({ range }) {
  return React.createElement("div", { "data-slot": "test-chart" }, `Chart ${range}`);
}

function okSymbolData(ticker, overrides = {}) {
  return {
    symbol: ticker,
    quote: {
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
    },
    overview: {
      symbol: ticker,
      status: "ok",
      name: ticker === "MSFT" ? "Microsoft Corporation" : ticker,
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
    positionRows: [],
    alertRows: [],
    memberships: [],
    quoteLoading: false,
    overviewLoading: false,
    historyLoading: false,
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
