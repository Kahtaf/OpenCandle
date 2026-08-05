import { describe, expect, it } from "vitest";
import {
  degradedQuoteBadge,
  formatHumanDateTime,
  quoteChangeDirections,
  quoteFreshnessTitle,
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

describe("formatHumanDateTime", () => {
  it("humanizes exact timestamps for report copy and stale quote tooltips", () => {
    expect(formatHumanDateTime("2026-07-05T22:05:31.730Z", "UTC")).toBe("Jul 5, 10:05 PM");
    expect(quoteFreshnessTitle([{ fetchedAt: "2026-07-05T22:05:31.730Z" }], "UTC")).toBe(
      "Fetched Jul 5, 10:05 PM",
    );
  });
});

describe("degradedQuoteBadge", () => {
  it("uses fetch time for pipeline staleness and provider time for prior-day data", () => {
    expect(
      degradedQuoteBadge([{ status: "ok", fetchedAt: "2026-06-12T14:50:00Z" }], NOW),
    ).toBeNull();
    expect(
      degradedQuoteBadge([{ status: "ok", fetchedAt: "2026-06-12T14:45:00Z" }], NOW),
    ).toBeNull();
    expect(degradedQuoteBadge([{ status: "ok", fetchedAt: "2026-06-12T14:34:00Z" }], NOW)).toBe(
      "Quotes 26m old",
    );
    expect(
      degradedQuoteBadge(
        [
          {
            status: "ok",
            fetchedAt: "2026-06-12T14:59:00Z",
            dataAsOf: "2026-06-11T18:00:00Z",
          },
        ],
        NOW,
      ),
    ).toBe("As of Jun 11");
    expect(
      degradedQuoteBadge(
        [
          {
            status: "ok",
            fetchedAt: "2026-06-12T14:59:00Z",
            dataAsOf: "2026-06-11T18:00:00Z",
            extendedPrice: 83.02,
          },
        ],
        NOW,
      ),
    ).toBeNull();
    expect(degradedQuoteBadge([{ status: "unavailable" }], NOW)).toBe("Quotes unavailable");
    expect(
      degradedQuoteBadge(
        [
          {
            status: "ok",
            refreshStatus: "unavailable",
            fetchedAt: "2026-06-12T14:34:00Z",
          },
        ],
        NOW,
      ),
    ).toBe("Quotes unavailable · last updated 26m ago");
  });
});

describe("degradedQuoteBadge vocabulary", () => {
  it("uses the as-of date instead of a raw minute count for hours-old prior-day quotes", () => {
    // Regression: the badge printed "Quotes 1051m old" on a Wednesday morning.
    expect(
      degradedQuoteBadge(
        [
          {
            status: "ok",
            fetchedAt: "2026-06-11T21:29:00Z",
            dataAsOf: "2026-06-11T20:00:00Z",
          },
        ],
        NOW,
      ),
    ).toBe("As of Jun 11");
  });

  it("uses hours when the pipeline stalled but the data is still from today", () => {
    expect(
      degradedQuoteBadge(
        [
          {
            status: "ok",
            fetchedAt: "2026-06-12T11:30:00Z",
            dataAsOf: "2026-06-12T11:29:00Z",
          },
        ],
        NOW,
      ),
    ).toBe("Quotes 3h old");
  });

  it("keeps prior-day as-of copy even when an extended-session quote is present", () => {
    expect(
      degradedQuoteBadge(
        [
          {
            status: "ok",
            fetchedAt: "2026-06-11T21:29:00Z",
            dataAsOf: "2026-06-11T20:00:00Z",
            extendedPrice: 83.02,
          },
        ],
        NOW,
      ),
    ).toBe("As of Jun 11");
  });

  it("never renders a minute count of an hour or more, and never names a provider", () => {
    for (let ageMinutes = 16; ageMinutes <= 60 * 48; ageMinutes += 7) {
      const fetchedAt = new Date(NOW - ageMinutes * 60_000).toISOString();
      for (const dataAsOf of [fetchedAt, undefined]) {
        const badge = degradedQuoteBadge([{ status: "ok", fetchedAt, dataAsOf }], NOW);
        if (badge === null) continue;
        expect(badge).not.toMatch(/ticker line/i);
        const minutes = badge.match(/(\d+)m old/);
        if (minutes) expect(Number(minutes[1])).toBeLessThan(60);
      }
    }
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
