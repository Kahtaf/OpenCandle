import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EntityPopover } from "../../../gui/web/src/features/chat/entity-popover.jsx";

const baseMarketState = {
  watchlists: [],
  watchlist: [],
  portfolio: [],
  quoteSnapshot: { watchlistQuotes: [], portfolioQuotes: [] },
};

describe("EntityPopover", () => {
  it("offers an encoded symbol-page action beside the ask action", () => {
    const html = renderToStaticMarkup(
      React.createElement(EntityPopover, {
        open: true,
        symbol: "TSLA",
        marketState: baseMarketState,
        resolvedCandidate: { symbol: "TSLA" },
        navigate: vi.fn(),
        onAddToWatchlist: vi.fn(),
        onAskAbout: vi.fn(),
      }),
    );

    expect(html).toContain('href="/symbol/TSLA"');
    expect(html).toContain("Open $TSLA page");
    expect(html).toContain("Ask about $TSLA");
    expect(html).toContain("focus-visible:ring-2");
  });

  it("renders cached quote price and change without freshness copy", () => {
    const html = renderToStaticMarkup(
      React.createElement(EntityPopover, {
        open: true,
        symbol: "NVDA",
        marketState: {
          ...baseMarketState,
          watchlist: [{ symbol: "NVDA", name: "NVIDIA Corp." }],
          quoteSnapshot: {
            watchlistQuotes: [
              {
                symbol: "NVDA",
                status: "ok",
                price: 920.5,
                changePercent: 1.25,
                freshness: { line: "As of 4:00 PM ET" },
              },
            ],
            portfolioQuotes: [],
          },
        },
        resolvedCandidate: { symbol: "NVDA" },
        onAddToWatchlist: vi.fn(),
        onAskAbout: vi.fn(),
      }),
    );

    expect(html).toContain("NVIDIA Corp.");
    expect(html).toContain("$920.50");
    expect(html).toContain("+1.25%");
    expect(html).not.toContain("As of 4:00 PM ET");
  });

  it("renders a held badge for portfolio symbols", () => {
    const html = renderToStaticMarkup(
      React.createElement(EntityPopover, {
        open: true,
        symbol: "AMD",
        marketState: {
          ...baseMarketState,
          portfolio: [{ symbol: "AMD", name: "Advanced Micro Devices", quantity: 10 }],
        },
        resolvedCandidate: { symbol: "AMD" },
        onAddToWatchlist: vi.fn(),
        onAskAbout: vi.fn(),
      }),
    );

    expect(html).toContain("Held");
  });

  it("renders no-cached-quote state without price data", () => {
    const html = renderToStaticMarkup(
      React.createElement(EntityPopover, {
        open: true,
        symbol: "AA",
        marketState: baseMarketState,
        resolvedCandidate: { symbol: "AA" },
        onAddToWatchlist: vi.fn(),
        onAskAbout: vi.fn(),
      }),
    );

    expect(html).toContain("No recent quote in this session");
    expect(html).toContain("Watchlist");
    expect(html).toContain("Default");
    expect(html).toContain("Add to Default");
    expect(html).toContain("Ask about $AA");
  });

  it("lets add-to-watchlist choose a named watchlist", () => {
    const html = renderToStaticMarkup(
      React.createElement(EntityPopover, {
        open: true,
        symbol: "AA",
        marketState: {
          ...baseMarketState,
          watchlists: [
            { id: 1, name: "MAG7" },
            { id: 2, name: "ETFs" },
          ],
        },
        resolvedCandidate: { symbol: "AA" },
        onAddToWatchlist: vi.fn(),
        onAskAbout: vi.fn(),
      }),
    );

    expect(html).toContain(">MAG7</option>");
    expect(html).toContain(">ETFs</option>");
    expect(html).toContain("Add to MAG7");
  });

  it("renders recent session quote details when the symbol is not in saved state", () => {
    const html = renderToStaticMarkup(
      React.createElement(EntityPopover, {
        open: true,
        symbol: "SNDK",
        marketState: baseMarketState,
        sessionMarketFacts: {
          SNDK: {
            symbol: "SNDK",
            name: "Sandisk Corporation",
            price: 1575.12,
            change: -169.31,
            changePercent: -9.71,
            open: 1619.86,
            high: 1638.88,
            low: 1485.02,
            volume: 11_320_000,
            pe: 53.74,
            timestamp: 1_783_443_600_000,
          },
        },
        resolvedCandidate: { symbol: "SNDK" },
        onAddToWatchlist: vi.fn(),
        onAskAbout: vi.fn(),
      }),
    );

    expect(html).toContain("Sandisk Corporation");
    expect(html).toContain("$1575.12");
    expect(html).toContain("-9.71%");
    expect(html).toContain("Open");
    expect(html).toContain("P/E");
    expect(html).not.toContain("No cached quote");
    expect(html).toContain("grid-cols-[auto_minmax(0,1fr)]");
    expect(html).not.toContain("bg-card/70");
  });

  it("omits the company-name line when quote and saved state have no name", () => {
    const html = renderToStaticMarkup(
      React.createElement(EntityPopover, {
        open: true,
        symbol: "AA",
        marketState: {
          ...baseMarketState,
          quoteSnapshot: {
            watchlistQuotes: [{ symbol: "AA", status: "ok", price: 30 }],
            portfolioQuotes: [],
          },
        },
        resolvedCandidate: { symbol: "AA" },
        onAddToWatchlist: vi.fn(),
        onAskAbout: vi.fn(),
      }),
    );

    expect(html).not.toContain('class="truncate text-xs text-muted-foreground">AA</div>');
  });

  it("disables add-to-watchlist when resolution failed", () => {
    const html = renderToStaticMarkup(
      React.createElement(EntityPopover, {
        open: true,
        symbol: "ZZZZZZ",
        marketState: baseMarketState,
        resolvedCandidate: null,
        resolutionError: "unresolved symbol",
        onAddToWatchlist: vi.fn(),
        onAskAbout: vi.fn(),
      }),
    );

    expect(html).toContain("disabled");
    expect(html).toContain("unresolved symbol");
  });
});
