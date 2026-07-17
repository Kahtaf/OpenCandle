import { describe, expect, it } from "vitest";
import { orderWatchlistMovers } from "../../../gui/web/src/features/home/home-view-model.js";

describe("orderWatchlistMovers", () => {
  it("sorts mixed signs by absolute change and leaves missing changes last", () => {
    const quotes = [
      { symbol: "FLAT", changePercent: 0.5 },
      { symbol: "DOWN", changePercent: -3.2 },
      { symbol: "MISSING" },
      { symbol: "UP", changePercent: 1.4 },
      { symbol: "INVALID", changePercent: Number.NaN },
    ];

    const ordered = orderWatchlistMovers(quotes);

    expect(ordered.map((quote) => quote.symbol)).toEqual([
      "DOWN",
      "UP",
      "FLAT",
      "MISSING",
      "INVALID",
    ]);
    expect(quotes.map((quote) => quote.symbol)).toEqual([
      "FLAT",
      "DOWN",
      "MISSING",
      "UP",
      "INVALID",
    ]);
  });
});
