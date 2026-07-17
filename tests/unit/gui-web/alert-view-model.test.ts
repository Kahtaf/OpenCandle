import { describe, expect, it } from "vitest";
import { buildAlertRows } from "../../../gui/web/src/features/market-state/alert-view-model.js";

describe("alert view model", () => {
  it("shows manual mode, last observed value, latest event, and status", () => {
    const rows = buildAlertRows(
      [
        {
          id: 1,
          scopeType: "instrument",
          instrumentId: 42,
          conditionType: "price_crosses_above",
          conditionVersion: 1,
          conditionJson: { threshold: 250, field: "last_price" },
          enabled: true,
          checkIntervalSeconds: null,
          lastCheckedAt: "2026-05-31T12:00:00.000Z",
          lastObservedJson: {
            field: "last_price",
            value: 251.25,
            at: "2026-05-31T12:00:00.000Z",
          },
        },
      ],
      [
        {
          id: 1,
          alertRuleId: 1,
          instrumentId: 42,
          observedValueJson: { value: 251.25 },
          triggeredAt: "2026-05-31T12:00:00.000Z",
          status: "triggered",
          message: "AAPL price crossed above $250",
        },
      ],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        rule: "price_crosses_above $250",
        scope: "Instrument #42",
        mode: "Manual",
        lastChecked: "2026-05-31 12:00:00Z",
        lastObserved: "price $251.25 · above $250.00, waiting for next upward cross",
        latestEvent: "2026-05-31 12:00:00Z triggered: AAPL price crossed above $250",
        status: "triggered",
        enabled: true,
        toggleLabel: "Disable",
      }),
    ]);
  });

  it("marks unsupported condition versions as needing review", () => {
    const rows = buildAlertRows([
      {
        id: 2,
        scopeType: "instrument",
        instrumentId: 99,
        conditionType: "price_crosses_above",
        conditionVersion: 2,
        conditionJson: { threshold: 100 },
        enabled: true,
        checkIntervalSeconds: 60,
        lastCheckedAt: null,
        lastObservedJson: null,
      },
    ]);

    expect(rows[0]).toMatchObject({
      mode: "Manual; 60s metadata",
      lastObserved: "Not checked",
      latestEvent: "None",
      status: "Needs review: v2",
      enabled: true,
      toggleLabel: "Disable",
    });
  });

  it("offers an enable action for paused alert rows", () => {
    const rows = buildAlertRows([
      {
        id: 3,
        scopeType: "instrument",
        instrumentId: 7,
        conditionType: "price_crosses_below",
        conditionVersion: 1,
        conditionJson: { threshold: 100 },
        enabled: false,
        checkIntervalSeconds: null,
        lastCheckedAt: null,
        lastObservedJson: null,
      },
    ]);

    expect(rows[0]).toMatchObject({
      status: "Disabled",
      enabled: false,
      toggleLabel: "Enable",
    });
  });
});
