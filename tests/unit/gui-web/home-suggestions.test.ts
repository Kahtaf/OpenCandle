import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  EmptyThread,
  homePromptsForMarketState,
} from "../../../gui/web/src/components/chat/prompt-suggestions.jsx";

describe("homePromptsForMarketState", () => {
  it("uses the existing generic prompts when there is no saved state", () => {
    expect(homePromptsForMarketState({})).toEqual([
      ["What is NVDA trading at?", "What is NVDA trading at?"],
      ["Compare NVDA and AMD", "Compare NVDA and AMD using latest quotes."],
      ["Options chain for NVDA", "Show options chain for NVDA"],
      ["Deep research: NVDA (multi-analyst, takes a few minutes)", "/analyze NVDA"],
    ]);
  });

  it("suggests the first named watchlist and portfolio that contain saved positions", () => {
    expect(
      homePromptsForMarketState({
        watchlists: [
          { id: "empty-watchlist", name: "Empty" },
          { id: "growth", name: "Growth" },
        ],
        watchlistItems: [{ id: "watchlist-item", watchlistId: "growth", symbol: "NVDA" }],
        portfolios: [
          { id: "empty-portfolio", name: "Empty portfolio" },
          { id: "brokerage", name: "Interactive Brokers" },
        ],
        portfolioLots: [{ id: "lot-1", portfolioId: "brokerage", symbol: "AMD" }],
      }),
    ).toEqual([
      ["What's moving in Growth?", "What's moving in my Growth watchlist?"],
      ["How is Interactive Brokers doing?", "How is my Interactive Brokers portfolio doing?"],
    ]);
  });

  it("allows long suggestion labels to wrap within the home width", () => {
    const html = renderToStaticMarkup(
      React.createElement(EmptyThread, {
        prompts: [["Deep research: NVDA (multi-analyst, takes a few minutes)", "/analyze NVDA"]],
      }),
    );

    expect(html).toContain("min-w-0");
    expect(html).toContain("max-w-full");
    expect(html).toContain("whitespace-normal");
  });
});
