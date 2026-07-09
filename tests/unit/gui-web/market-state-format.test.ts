import { describe, expect, it } from "vitest";
import { relativeTime, shortDateLabel } from "../../../gui/web/src/features/market-state/format.js";

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
