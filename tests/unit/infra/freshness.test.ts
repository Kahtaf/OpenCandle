import { describe, expect, it } from "vitest";
import { buildFreshnessStamp, formatAsOfLine } from "../../../src/infra/freshness.js";
import {
  classifyMarketStatusAt,
  lastTradingDay,
  marketHolidayName,
} from "../../../src/infra/market-calendar.js";

describe("buildFreshnessStamp", () => {
  it("treats a Friday quote fetched on Saturday as the latest completed session", () => {
    const stamp = buildFreshnessStamp({
      asOf: "2024-03-22T20:00:00.000Z",
      now: new Date("2024-03-23T16:00:00.000Z"),
    });

    expect(stamp.marketSession).toBe("closed_weekend");
    expect(stamp.providerDataAt).toBe("2024-03-22T20:00:00.000Z");
    expect(stamp.isStaleForSession).toBe(false);
  });

  it("treats a Thursday quote fetched on Saturday as session-stale", () => {
    const stamp = buildFreshnessStamp({
      asOf: "2024-03-21T20:00:00.000Z",
      now: new Date("2024-03-23T16:00:00.000Z"),
    });

    expect(stamp.marketSession).toBe("closed_weekend");
    expect(stamp.isStaleForSession).toBe(true);
  });

  it("treats prior-session equity quotes as stale while the market is open", () => {
    const stamp = buildFreshnessStamp({
      asOf: "2026-07-02",
      now: new Date("2026-07-06T14:00:00.000Z"),
    });

    expect(stamp.marketSession).toBe("open");
    expect(stamp.isStaleForSession).toBe(true);
  });

  it("accepts the last completed trading day before the market opens", () => {
    const stamp = buildFreshnessStamp({
      asOf: "2026-07-02",
      now: new Date("2026-07-06T12:00:00.000Z"),
    });

    expect(stamp.marketSession).toBe("pre_market");
    expect(stamp.isStaleForSession).toBe(false);
  });

  it("falls back to stale-cache status when provider market time is absent", () => {
    const stamp = buildFreshnessStamp({
      stale: true,
      cachedAt: "2026-07-03T18:10:00.000Z",
      now: new Date("2026-07-03T19:00:00.000Z"),
    });

    expect(stamp.cacheStatus).toBe("stale");
    expect(stamp.cachedAt).toBe("2026-07-03T18:10:00.000Z");
    expect(stamp.isStaleForSession).toBe(true);
  });

  it("preserves fresh cache-hit status separately from live and stale", () => {
    const stamp = buildFreshnessStamp({
      cached: true,
      cachedAt: "2026-07-03T18:10:00.000Z",
      now: new Date("2026-07-03T18:11:00.000Z"),
    });

    expect(stamp.cacheStatus).toBe("cached");
    expect(stamp.cachedAt).toBe("2026-07-03T18:10:00.000Z");
    expect(stamp.isStaleForSession).toBe(false);
  });

  it("normalizes epoch seconds, epoch milliseconds, ISO strings, Dates, and date-only inputs", () => {
    const now = new Date("2024-03-23T16:00:00.000Z");

    expect(buildFreshnessStamp({ asOf: 1711137600, now }).providerDataAt).toBe(
      "2024-03-22T20:00:00.000Z",
    );
    expect(buildFreshnessStamp({ asOf: 1711137600000, now }).providerDataAt).toBe(
      "2024-03-22T20:00:00.000Z",
    );
    expect(buildFreshnessStamp({ asOf: "2024-03-22T20:00:00.000Z", now }).providerDataAt).toBe(
      "2024-03-22T20:00:00.000Z",
    );
    expect(
      buildFreshnessStamp({ asOf: new Date("2024-03-22T20:00:00.000Z"), now }).providerDataAt,
    ).toBe("2024-03-22T20:00:00.000Z");
    expect(buildFreshnessStamp({ asOf: "2024-03-22", now }).providerDataAt).toBe(
      "2024-03-22T00:00:00.000Z",
    );
    expect(buildFreshnessStamp({ asOf: "2024-03-22", now }).providerDataDate).toBe("2024-03-22");
  });

  it("uses a 15-minute freshness rule for crypto", () => {
    const fresh = buildFreshnessStamp({
      assetClass: "crypto",
      asOf: "2026-07-03T18:50:01.000Z",
      now: new Date("2026-07-03T19:05:00.000Z"),
    });
    const stale = buildFreshnessStamp({
      assetClass: "crypto",
      asOf: "2026-07-03T18:49:59.000Z",
      now: new Date("2026-07-03T19:05:00.000Z"),
    });

    expect(fresh.marketSession).toBe("unknown");
    expect(fresh.isStaleForSession).toBe(false);
    expect(stale.isStaleForSession).toBe(true);
  });

  it("classifies post-close stamps as closed_after_hours without prompt temporal references", () => {
    expect(classifyMarketStatusAt(new Date("2026-05-22T20:01:00.000Z"))).toBe("closed_after_hours");
  });

  it("computes market holidays beyond the current year", () => {
    expect(marketHolidayName("2027-01-01")).toBe("New Year's Day");
    expect(classifyMarketStatusAt(new Date("2027-01-01T15:00:00.000Z"))).toBe("closed_holiday");
    expect(lastTradingDay("2027-01-04")).toBe("2026-12-31");
  });
});

describe("formatAsOfLine", () => {
  it("formats a live current line", () => {
    expect(
      formatAsOfLine(
        buildFreshnessStamp({
          asOf: "2026-07-02T20:00:00.000Z",
          now: new Date("2026-07-02T15:00:00.000Z"),
        }),
      ),
    ).toMatchInlineSnapshot(`"As of 2026-07-02 16:00 ET (market open)."`);
  });

  it("formats a delayed line", () => {
    expect(
      formatAsOfLine(
        buildFreshnessStamp({
          asOf: "2026-07-02T19:45:00.000Z",
          dataDelayMs: 15 * 60_000,
          now: new Date("2026-07-02T15:00:00.000Z"),
        }),
      ),
    ).toMatchInlineSnapshot(`"As of 2026-07-02 15:45 ET (~15m delayed)."`);
  });

  it("formats cached delayed data from the cache timestamp when provider time is absent", () => {
    expect(
      formatAsOfLine(
        buildFreshnessStamp({
          cached: true,
          cachedAt: "2026-07-03T18:10:00.000Z",
          dataDelayMs: 15 * 60_000,
          now: new Date("2026-07-03T19:00:00.000Z"),
        }),
      ),
    ).toMatchInlineSnapshot(`"As of 2026-07-03 14:10 ET (~15m delayed)."`);
  });

  it("formats date-only provider as-of values as the market date", () => {
    expect(
      formatAsOfLine(
        buildFreshnessStamp({
          asOf: "2026-07-02",
          now: new Date("2026-07-02T15:00:00.000Z"),
        }),
      ),
    ).toMatchInlineSnapshot(`"As of 2026-07-02 ET (market open)."`);
  });

  it("formats a session-stale line", () => {
    expect(
      formatAsOfLine(
        buildFreshnessStamp({
          asOf: "2024-03-21T20:00:00.000Z",
          now: new Date("2024-03-23T16:00:00.000Z"),
        }),
      ),
    ).toMatchInlineSnapshot(
      `"Last available price as of 2024-03-21 (market closed — weekend). This is not a live quote."`,
    );
  });

  it("formats stale date-only provider as-of values as the market date", () => {
    expect(
      formatAsOfLine(
        buildFreshnessStamp({
          asOf: "2026-07-02",
          now: new Date("2026-07-06T14:00:00.000Z"),
        }),
      ),
    ).toMatchInlineSnapshot(`"Last available price as of 2026-07-02. This is not a live quote."`);
  });

  it("formats a stale-cache line", () => {
    expect(
      formatAsOfLine(
        buildFreshnessStamp({
          stale: true,
          cachedAt: "2026-07-03T18:10:00.000Z",
          now: new Date("2026-07-03T19:00:00.000Z"),
          assetClass: "crypto",
        }),
      ),
    ).toMatchInlineSnapshot(
      `"Using cached data from 2026-07-03 14:10 ET (provider unavailable). This is not a live quote."`,
    );
  });
});
