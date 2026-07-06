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

    expect(html).toContain("No cached quote");
    expect(html).toContain("Add to watchlist");
    expect(html).toContain("Ask about $AA");
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
