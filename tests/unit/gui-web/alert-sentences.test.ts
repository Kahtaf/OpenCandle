import { describe, expect, it } from "vitest";
import { buildAlertSentenceRows } from "../../../gui/web/src/features/market-state/alert-view-model.js";

const NOW = Date.parse("2026-06-12T15:00:00Z");
const INSTRUMENTS = [
  { id: 1, symbol: "NVDA", name: "NVIDIA Corporation" },
  { id: 3, symbol: "TSLA", name: "Tesla Inc." },
];

function rule(overrides = {}) {
  return {
    id: 10,
    scopeType: "instrument",
    scopeId: null,
    instrumentId: 1,
    conditionType: "price_crosses_above",
    conditionVersion: 1,
    conditionJson: { type: "price_crosses_above", threshold: 220 },
    timeframe: "quote",
    enabled: true,
    lastCheckedAt: "2026-06-12T14:56:00Z",
    lastObservedJson: { field: "price", value: 204.25, at: "2026-06-12T14:56:00Z" },
    retriggerMode: "recurring",
    ...overrides,
  };
}

describe("buildAlertSentenceRows", () => {
  it("renders a price threshold rule as a plain-English sentence with symbol", () => {
    const [row] = buildAlertSentenceRows([rule()], [], INSTRUMENTS, NOW);

    expect(row.symbol).toBe("NVDA");
    expect(row.sentence).toBe("Price crosses above $220.00");
    expect(row.detail).toBe("Armed · last checked 4m ago at $204.25");
    expect(row.tone).toBe("armed");
    expect(row.enabled).toBe(true);
  });

  it("describes RSI, percent-move, SMA, and volume rules in plain English", () => {
    const rows = buildAlertSentenceRows(
      [
        rule({ id: 1, instrumentId: 3, conditionType: "rsi_threshold", conditionJson: { direction: "above", threshold: 70, period: 14 } }),
        rule({ id: 2, conditionType: "percent_move", conditionJson: { direction: "down", percent: 5, window: "1d" } }),
        rule({ id: 3, conditionType: "price_crosses_sma", conditionJson: { direction: "below", period: 50, price_field: "close" } }),
        rule({ id: 4, conditionType: "sma_cross", conditionJson: { direction: "above", fast_period: 50, slow_period: 200 } }),
        rule({ id: 5, conditionType: "volume_spike", conditionJson: { lookback_period: 20, multiplier: 3 } }),
      ],
      [],
      INSTRUMENTS,
      NOW,
    );

    expect(rows.map((row) => row.sentence)).toEqual([
      "RSI (14-day) rises above 70",
      "Falls more than 5% in a day",
      "Price drops below the 50-day average",
      "50-day average crosses above the 200-day average",
      "Volume spikes to 3× the 20-day average",
    ]);
  });

  it("marks paused rules and never-checked rules", () => {
    const rows = buildAlertSentenceRows(
      [
        rule({ id: 1, enabled: false }),
        rule({ id: 2, lastCheckedAt: null, lastObservedJson: null }),
      ],
      [],
      INSTRUMENTS,
      NOW,
    );

    expect(rows[0].tone).toBe("paused");
    expect(rows[0].detail).toBe("Paused");
    expect(rows[1].detail).toBe("Armed · not checked yet");
  });

  it("falls back to the scope label when the instrument is unknown", () => {
    const [row] = buildAlertSentenceRows([rule({ instrumentId: 99 })], [], INSTRUMENTS, NOW);
    expect(row.symbol).toBe("Unknown");
  });
});
