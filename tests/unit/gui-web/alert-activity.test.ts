import { describe, expect, it } from "vitest";
import {
  alertCadenceSentence,
  alertPreviewSentence,
  buildActivityRows,
  thresholdDistanceHint,
} from "../../../gui/web/src/features/market-state/alert-view-model.js";

const INSTRUMENTS = [
  { id: 7, symbol: "RKLB", name: "Rocket Lab" },
  { id: 9, symbol: "NVDA", name: "NVIDIA Corporation" },
];

describe("buildActivityRows", () => {
  it("shows one row per alert firing instead of repeating it as a notification", () => {
    const rows = buildActivityRows({
      alertEvents: [
        {
          id: 4,
          alertRuleId: 1,
          instrumentId: 7,
          status: "triggered",
          message: "crossed above $50.00",
          observedAt: "2026-08-04T14:00:00.000Z",
          triggeredAt: "2026-08-04T14:00:00.000Z",
        },
      ],
      notifications: [
        {
          id: 22,
          sourceType: "alert_event",
          sourceId: 4,
          status: "unread",
          severity: "warning",
          title: "Alert triggered",
          createdAt: "2026-08-04T14:00:00.000Z",
        },
      ],
      instruments: INSTRUMENTS,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("RKLB crossed above $50.00");
    expect(rows[0].unread).toBe(true);
    expect(rows[0].notificationId).toBe(22);
    expect(rows[0].badge).toBeNull();
  });

  it("keeps notifications that no alert event covers, newest first", () => {
    const rows = buildActivityRows({
      alertEvents: [
        {
          id: 4,
          alertRuleId: 1,
          instrumentId: 9,
          status: "unavailable",
          message: "quote unavailable",
          observedAt: "2026-08-04T10:00:00.000Z",
        },
      ],
      notifications: [
        {
          id: 30,
          sourceType: "report_run",
          sourceId: 3,
          status: "acknowledged",
          severity: "error",
          title: "Daily watchlist report failed",
          createdAt: "2026-08-04T12:00:00.000Z",
        },
      ],
      instruments: INSTRUMENTS,
    });

    expect(rows.map((row) => row.title)).toEqual([
      "Daily watchlist report failed",
      "NVDA quote unavailable",
    ]);
    expect(rows[0].unread).toBe(false);
    expect(rows[1].badge).toBe("Data unavailable");
    expect(rows[1].notificationId).toBeNull();
  });

  it("reports a failed delivery attempt instead of naming the delivery channel", () => {
    const rows = buildActivityRows({
      alertEvents: [],
      notifications: [
        {
          id: 30,
          sourceType: "report_run",
          status: "unread",
          severity: "warning",
          title: "Daily watchlist report completed",
          createdAt: "2026-08-04T12:00:00.000Z",
        },
      ],
      deliveryAttempts: [{ notificationEventId: 30, status: "failed" }],
    });

    expect(rows[0].badge).toBe("Delivery failed");
    expect(JSON.stringify(rows)).not.toContain("in-app");
  });

  it("bounds the feed to the most recent entries", () => {
    const alertEvents = Array.from({ length: 30 }, (_, index) => ({
      id: index + 1,
      alertRuleId: 1,
      instrumentId: 7,
      status: "triggered",
      message: `crossed above $${index}.00`,
      observedAt: `2026-08-04T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    }));

    expect(buildActivityRows({ alertEvents, instruments: INSTRUMENTS }, 12)).toHaveLength(12);
  });
});

describe("alertPreviewSentence", () => {
  it("previews the rule with the same words the saved rule row uses", () => {
    expect(alertPreviewSentence({ condition: "create_price_above", threshold: "220" })).toBe(
      "Price crosses above $220.00",
    );
    expect(alertPreviewSentence({ condition: "create_price_below", threshold: "" })).toBe(
      "Price drops below a price you set",
    );
    expect(
      alertPreviewSentence({ condition: "create_rsi_below", threshold: "30", period: "14" }),
    ).toBe("RSI (14-day) falls below 30");
    expect(
      alertPreviewSentence({
        condition: "create_sma_cross_above",
        fastPeriod: "50",
        slowPeriod: "200",
      }),
    ).toBe("50-day average crosses above the 200-day average");
    expect(
      alertPreviewSentence({ condition: "create_volume_spike", threshold: "2", period: "20" }),
    ).toBe("Volume spikes to 2× the 20-day average");
    expect(alertPreviewSentence({ condition: "create_percent_move_down", threshold: "5" })).toBe(
      "Falls more than 5% in a day",
    );
    expect(alertPreviewSentence({ condition: "create_price_below_sma", period: "50" })).toBe(
      "Price drops below the 50-day average",
    );
  });

  it("prices the previewed level in the quote's own currency", () => {
    // The level is prefilled from the instrument's quote, so a EUR listing must
    // not be previewed as dollars beside a hint that already reads EUR.
    expect(
      alertPreviewSentence({
        condition: "create_price_above",
        threshold: "168.64",
        currency: "EUR",
      }),
    ).toBe("Price crosses above EUR 168.64");
    expect(
      alertPreviewSentence({ condition: "create_price_below", threshold: "220", currency: "USD" }),
    ).toBe("Price drops below $220.00");
  });
});

describe("alertCadenceSentence", () => {
  it("states the repeat window in human units", () => {
    expect(alertCadenceSentence(3600)).toBe(
      "Repeats at most once an hour while OpenCandle is open",
    );
    expect(alertCadenceSentence("900")).toBe(
      "Repeats at most once every 15 minutes while OpenCandle is open",
    );
    expect(alertCadenceSentence(86_400)).toBe(
      "Repeats at most once a day while OpenCandle is open",
    );
    expect(alertCadenceSentence(0)).toBe("Repeats on every check while OpenCandle is open");
  });

  it("keeps a cooldown that does not divide evenly in a unit that does", () => {
    // Rules saved outside the sheet can carry any whole-second cooldown, and
    // rounding one into the nearest unit states a cadence the alert never uses.
    expect(alertCadenceSentence(5400)).toBe(
      "Repeats at most once every 90 minutes while OpenCandle is open",
    );
    expect(alertCadenceSentence(90)).toBe(
      "Repeats at most once every 90 seconds while OpenCandle is open",
    );
    expect(alertCadenceSentence(129_600)).toBe(
      "Repeats at most once every 36 hours while OpenCandle is open",
    );
    expect(alertCadenceSentence(1)).toBe("Repeats at most once a second while OpenCandle is open");
  });
});

describe("thresholdDistanceHint", () => {
  it("compares the typed threshold with the current price", () => {
    expect(thresholdDistanceHint(204.25, "220", "USD")).toBe("Current $204.25 · 7.7% above");
    expect(thresholdDistanceHint(204.25, "190", "USD")).toBe("Current $204.25 · 7.0% below");
    expect(thresholdDistanceHint(204.25, "204.25", "USD")).toBe(
      "Current $204.25 · at the current price",
    );
    expect(thresholdDistanceHint(204.25, "", "USD")).toBe("Current $204.25");
    expect(thresholdDistanceHint(null, "220", "USD")).toBeNull();
  });
});
