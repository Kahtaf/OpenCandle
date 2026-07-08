import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { EntityPopover } from "../../../gui/web/src/features/chat/entity-popover.jsx";

const baseMarketState = {
  watchlist: [],
  portfolio: [],
  quoteSnapshot: { watchlistQuotes: [], portfolioQuotes: [] },
};

describe("EntityPopover", () => {
  it("renders cached quote price, change, and freshness", () => {
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
    expect(html).toContain("As of 4:00 PM ET");
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
    expect(html).toContain("Add to watchlist");
    expect(html).toContain("Ask about $AA");
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
