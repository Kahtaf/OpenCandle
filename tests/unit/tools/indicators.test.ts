import { describe, it, expect } from "vitest";
import {
  computeSMA,
  computeEMA,
  computeRSI,
  computeMACD,
  computeBollingerBands,
} from "../../../src/tools/technical/indicators.js";

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
