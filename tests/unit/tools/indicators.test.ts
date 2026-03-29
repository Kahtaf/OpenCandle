import { describe, it, expect } from "vitest";
import {
  computeSMA,
  computeEMA,
  computeRSI,
  computeMACD,
  computeBollingerBands,
  computeOBV,
  computeVWAP,
} from "../../../src/tools/technical/indicators.js";
import type { OHLCV } from "../../../src/types/market.js";

// 50-point price series for deterministic testing (need 35+ for MACD)
const prices = [
  100, 102, 101, 103, 105, 104, 106, 108, 107, 109,
  111, 110, 112, 114, 113, 115, 117, 116, 118, 120,
  119, 121, 123, 122, 124, 126, 125, 127, 129, 128,
  130, 132, 131, 133, 135, 134, 136, 138, 137, 139,
  141, 140, 142, 144, 143, 145, 147, 146, 148, 150,
];

describe("computeSMA", () => {
  it("computes simple moving average correctly", () => {
    const sma = computeSMA([10, 20, 30, 40, 50], 3);
    expect(sma).toHaveLength(3);
    expect(sma[0]).toBeCloseTo(20, 5); // (10+20+30)/3
    expect(sma[1]).toBeCloseTo(30, 5); // (20+30+40)/3
    expect(sma[2]).toBeCloseTo(40, 5); // (30+40+50)/3
  });

  it("returns empty for insufficient data", () => {
    const sma = computeSMA([10, 20], 5);
    expect(sma).toHaveLength(0);
  });

  it("period 1 returns the original data", () => {
    const data = [5, 10, 15];
    const sma = computeSMA(data, 1);
    expect(sma).toEqual(data);
  });
});

describe("computeEMA", () => {
  it("first EMA value equals SMA of first period values", () => {
    const ema = computeEMA([10, 20, 30, 40, 50], 3);
    expect(ema[0]).toBeCloseTo(20, 5); // SMA(10,20,30) = 20
  });

  it("EMA reacts faster than SMA to recent prices", () => {
    const data = [10, 10, 10, 10, 10, 50]; // spike at end
    const sma = computeSMA(data, 3);
    const ema = computeEMA(data, 3);
    // EMA should be higher than SMA at the end because of the spike
    expect(ema[ema.length - 1]).toBeGreaterThan(sma[sma.length - 1]);
  });

  it("produces correct number of values", () => {
    const ema = computeEMA(prices, 12);
    expect(ema).toHaveLength(prices.length - 12 + 1);
  });
});

describe("computeRSI", () => {
  it("returns values between 0 and 100", () => {
    const rsi = computeRSI(prices, 14);
    for (const v of rsi) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("trending up prices give RSI above 50", () => {
    const uptrend = Array.from({ length: 30 }, (_, i) => 100 + i);
    const rsi = computeRSI(uptrend, 14);
    expect(rsi[rsi.length - 1]).toBeGreaterThan(50);
  });

  it("trending down prices give RSI below 50", () => {
    const downtrend = Array.from({ length: 30 }, (_, i) => 200 - i);
    const rsi = computeRSI(downtrend, 14);
    expect(rsi[rsi.length - 1]).toBeLessThan(50);
  });

  it("returns empty for insufficient data", () => {
    const rsi = computeRSI([100, 101, 102], 14);
    expect(rsi).toHaveLength(0);
  });
});

describe("computeMACD", () => {
  it("produces MACD, signal, and histogram", () => {
    const macd = computeMACD(prices);
    expect(macd.length).toBeGreaterThan(0);
    const last = macd[macd.length - 1];
    expect(last).toHaveProperty("macd");
    expect(last).toHaveProperty("signal");
    expect(last).toHaveProperty("histogram");
  });

  it("histogram equals macd minus signal", () => {
    const macd = computeMACD(prices);
    for (const entry of macd) {
      expect(entry.histogram).toBeCloseTo(entry.macd - entry.signal, 10);
    }
  });
});

describe("computeBollingerBands", () => {
  it("middle band equals SMA", () => {
    const bb = computeBollingerBands(prices, 20, 2);
    const sma = computeSMA(prices, 20);
    for (let i = 0; i < bb.length; i++) {
      expect(bb[i].middle).toBeCloseTo(sma[i], 10);
    }
  });

  it("upper band is above middle, lower is below", () => {
    const bb = computeBollingerBands(prices, 20, 2);
    for (const b of bb) {
      expect(b.upper).toBeGreaterThanOrEqual(b.middle);
      expect(b.lower).toBeLessThanOrEqual(b.middle);
    }
  });

  it("bands are symmetric around middle", () => {
    const bb = computeBollingerBands(prices, 20, 2);
    for (const b of bb) {
      expect(b.upper - b.middle).toBeCloseTo(b.middle - b.lower, 10);
    }
  });
});

// Helper to build OHLCV bars for OBV/VWAP tests
function makeBars(data: Array<{ close: number; volume: number; high?: number; low?: number }>): OHLCV[] {
  return data.map((d, i) => ({
    date: `2024-01-${String(i + 1).padStart(2, "0")}`,
    open: d.close,
    high: d.high ?? d.close + 1,
    low: d.low ?? d.close - 1,
    close: d.close,
    volume: d.volume,
  }));
}

describe("computeOBV", () => {
  it("adds volume on up days and subtracts on down days", () => {
    const bars = makeBars([
      { close: 100, volume: 1000 },
      { close: 105, volume: 2000 },  // up → +2000
      { close: 103, volume: 1500 },  // down → -1500
      { close: 108, volume: 3000 },  // up → +3000
    ]);
    const obv = computeOBV(bars);
    expect(obv).toHaveLength(4);
    expect(obv[0]).toBe(0);
    expect(obv[1]).toBe(2000);      // 0 + 2000
    expect(obv[2]).toBe(500);       // 2000 - 1500
    expect(obv[3]).toBe(3500);      // 500 + 3000
  });

  it("does not change OBV on flat days", () => {
    const bars = makeBars([
      { close: 100, volume: 1000 },
      { close: 100, volume: 5000 },  // flat → no change
    ]);
    const obv = computeOBV(bars);
    expect(obv[1]).toBe(0);
  });

  it("returns single element for single bar", () => {
    const bars = makeBars([{ close: 100, volume: 1000 }]);
    const obv = computeOBV(bars);
    expect(obv).toHaveLength(1);
    expect(obv[0]).toBe(0);
  });
});

describe("computeVWAP", () => {
  it("computes cumulative volume-weighted average price", () => {
    const bars: OHLCV[] = [
      { date: "2024-01-01", open: 100, high: 110, low: 90, close: 100, volume: 1000 },
      { date: "2024-01-02", open: 105, high: 115, low: 95, close: 105, volume: 2000 },
    ];
    const vwap = computeVWAP(bars);
    expect(vwap).toHaveLength(2);
    // Bar 1: TP = (110+90+100)/3 = 100, cumPV = 100000, cumVol = 1000, VWAP = 100
    expect(vwap[0]).toBeCloseTo(100, 2);
    // Bar 2: TP = (115+95+105)/3 = 105, cumPV = 100000+210000=310000, cumVol = 3000, VWAP = 103.33
    expect(vwap[1]).toBeCloseTo(310000 / 3000, 2);
  });

  it("returns 0 for zero volume", () => {
    const bars = makeBars([{ close: 100, volume: 0 }]);
    const vwap = computeVWAP(bars);
    expect(vwap[0]).toBe(0);
  });
});
