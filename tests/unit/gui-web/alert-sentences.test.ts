import { describe, expect, it } from "vitest";
import {
  buildAlertSentenceRows,
  formatAlertObservedValue,
} from "../../../gui/web/src/features/market-state/alert-view-model.js";

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
    expect(row.detail).toBe("Armed · last checked 4m ago · price $204.25 vs threshold $220.00");
    expect(row.tone).toBe("armed");
    expect(row.enabled).toBe(true);
  });

  it("prices a saved rule in the instrument's own currency", () => {
    // The rule is evaluated against a EUR listing, so reading it back as dollars
    // would state a monetary unit the alert never used.
    const [row] = buildAlertSentenceRows(
      [rule({ instrumentId: 5, conditionJson: { threshold: 168.64 } })],
      [],
      [{ id: 5, symbol: "SAP.DE", name: "SAP SE", currency: "EUR" }],
      NOW,
    );

    expect(row.symbol).toBe("SAP.DE");
    expect(row.sentence).toBe("Price crosses above EUR 168.64");
    expect(row.explanation).toContain("EUR 204.25");
    expect(row.explanation).not.toContain("$");
  });

  it("describes RSI, percent-move, SMA, and volume rules in plain English", () => {
    const rows = buildAlertSentenceRows(
      [
        rule({
          id: 1,
          instrumentId: 3,
          conditionType: "rsi_threshold",
          conditionJson: { direction: "above", threshold: 70, period: 14 },
        }),
        rule({
          id: 2,
          conditionType: "percent_move",
          conditionJson: { direction: "down", percent: 5, window: "1d" },
        }),
        rule({
          id: 3,
          conditionType: "price_crosses_sma",
          conditionJson: { direction: "below", period: 50, price_field: "close" },
        }),
        rule({
          id: 4,
          conditionType: "sma_cross",
          conditionJson: { direction: "above", fast_period: 50, slow_period: 200 },
        }),
        rule({
          id: 5,
          conditionType: "volume_spike",
          conditionJson: { lookback_period: 20, multiplier: 3 },
        }),
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

describe("formatAlertObservedValue", () => {
  it.each([
    {
      conditionType: "price_crosses_above",
      value: 50,
      expected: "price $50.00 vs threshold $55.00",
    },
    {
      conditionType: "price_crosses_above",
      value: 60.06,
      expected: "price $60.06 · above $55.00, waiting for next upward cross",
    },
    {
      conditionType: "price_crosses_below",
      value: 50,
      expected: "price $50.00 · below $55.00, waiting for next downward cross",
    },
  ])(
    "describes the observed edge state for $conditionType at $value",
    ({ conditionType, value, expected }) => {
      expect(formatAlertObservedValue(conditionType, { threshold: 55 }, { value })).toBe(expected);
    },
  );

  it("uses condition context and human units for every alert condition", () => {
    expect(
      formatAlertObservedValue(
        "price_crosses_above",
        { threshold: 80 },
        { field: "last_price", value: 83.55 },
      ),
    ).toBe("price $83.55 · above $80.00, waiting for next upward cross");
    expect(
      formatAlertObservedValue(
        "price_crosses_below",
        { threshold: 80 },
        { field: "last_price", value: 78.25 },
      ),
    ).toBe("price $78.25 · below $80.00, waiting for next downward cross");
    expect(
      formatAlertObservedValue(
        "price_crosses_sma",
        { direction: "below", period: 20 },
        { field: "price_sma_spread", value: -12.9, price: 82.62, sma: 95.52 },
      ),
    ).toBe("price $82.62 is 13.5% below the 20-day SMA");
    expect(
      formatAlertObservedValue(
        "rsi_threshold",
        { direction: "below", threshold: 30, period: 14 },
        { field: "rsi", value: 32.8 },
      ),
    ).toBe("RSI 32.8 vs threshold 30");
    expect(
      formatAlertObservedValue(
        "volume_spike",
        { lookback_period: 20, multiplier: 2 },
        { field: "volume_ratio", value: 2.1 },
      ),
    ).toBe("volume 2.1x its average");
    expect(
      formatAlertObservedValue(
        "percent_move",
        { direction: "up", percent: 3, window: "1d" },
        { field: "percent_move", value: 3.2 },
      ),
    ).toBe("moved +3.2% today");
    expect(
      formatAlertObservedValue(
        "sma_cross",
        { direction: "above", fast_period: 20, slow_period: 50 },
        { field: "sma_spread", value: -1.5, fast_sma: 98.5, slow_sma: 100 },
      ),
    ).toBe("20-day SMA $98.50 is 1.5% below 50-day SMA $100.00");
  });

  it("keeps incomplete historical observations explained instead of exposing a raw spread", () => {
    expect(
      formatAlertObservedValue(
        "price_crosses_sma",
        { direction: "below", period: 20 },
        { field: "price_sma_spread", value: -13.53 },
      ),
    ).toBe("price is below the 20-day SMA (exact values unavailable)");
  });
});
