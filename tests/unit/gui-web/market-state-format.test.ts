import { describe, expect, it } from "vitest";
import {
  degradedQuoteBadge,
  quoteChangeDirections,
  relativeTime,
  shortDateLabel,
} from "../../../gui/web/src/features/market-state/format.js";

const NOW = Date.parse("2026-06-12T15:00:00Z");

describe("relativeTime", () => {
  it("renders human-friendly distances from now", () => {
    expect(relativeTime("2026-06-12T14:59:40Z", NOW)).toBe("just now");
    expect(relativeTime("2026-06-12T14:58:00Z", NOW)).toBe("2m ago");
    expect(relativeTime("2026-06-12T11:00:00Z", NOW)).toBe("4h ago");
    expect(relativeTime("2026-06-09T08:00:00Z", NOW)).toBe("Jun 9");
    expect(relativeTime(null, NOW)).toBe("");
  });
});

describe("shortDateLabel", () => {
  it("renders compact dates and includes the year when needed", () => {
    expect(shortDateLabel("2026-06-09T08:00:00Z", NOW)).toBe("Jun 9");
    expect(shortDateLabel("2025-12-31T08:00:00Z", NOW)).toBe("Dec 31, 2025");
    expect(shortDateLabel(null, NOW)).toBe("");
  });
});

describe("degradedQuoteBadge", () => {
  it("stays silent for healthy quotes and labels only degraded snapshots", () => {
    expect(
      degradedQuoteBadge([{ status: "ok", fetchedAt: "2026-06-12T14:50:00Z" }], NOW),
    ).toBeNull();
    expect(degradedQuoteBadge([{ status: "ok", fetchedAt: "2026-06-12T14:34:00Z" }], NOW)).toBe(
      "Quotes 26m old",
    );
    expect(degradedQuoteBadge([{ status: "ok", fetchedAt: "2026-06-11T18:00:00Z" }], NOW)).toBe(
      "As of Jun 11",
    );
    expect(degradedQuoteBadge([{ status: "unavailable" }], NOW)).toBe("Quotes unavailable");
  });
});

describe("quoteChangeDirections", () => {
  it("returns per-symbol directions only for prices that changed after a prior snapshot", () => {
    const directions = quoteChangeDirections(
      new Map([
        ["AAPL", { price: 190 }],
        ["MSFT", { currentPrice: 400 }],
      ]),
      new Map([
        ["AAPL", { price: 191 }],
        ["MSFT", { currentPrice: 399 }],
        ["NVDA", { price: 150 }],
      ]),
    );

    expect([...directions.entries()]).toEqual([
      ["AAPL", "up"],
      ["MSFT", "down"],
    ]);
  });

  it("returns no directions for non-Map input instead of throwing", () => {
    // Regression: PortfolioPage once passed an array of holding rows, which
    // crashed the page inside the flash effect. Non-Map input must degrade to
    // "no flash", never an error boundary.
    const holdingsArray = [{ symbol: "AAPL", currentPrice: 150 }];
    expect(quoteChangeDirections(holdingsArray, holdingsArray).size).toBe(0);
    expect(quoteChangeDirections(new Map(), holdingsArray).size).toBe(0);
    expect(quoteChangeDirections(holdingsArray, new Map()).size).toBe(0);
  });
});
