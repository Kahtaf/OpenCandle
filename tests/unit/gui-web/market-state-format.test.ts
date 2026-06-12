import { describe, expect, it } from "vitest";
import { relativeTime, quoteFreshness } from "../../../gui/web/src/features/market-state/format.js";

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

describe("quoteFreshness", () => {
  it("labels fresh, stale, and missing quotes", () => {
    expect(quoteFreshness({ fetchedAt: "2026-06-12T14:58:00Z" }, NOW)).toEqual({
      label: "Updated 2m ago",
      stale: false,
    });
    expect(quoteFreshness({ fetchedAt: "2026-06-12T14:34:00Z" }, NOW)).toEqual({
      label: "Quote 26m old",
      stale: true,
    });
    expect(quoteFreshness(null, NOW)).toEqual({
      label: "Awaiting quotes",
      stale: null,
    });
  });
});
