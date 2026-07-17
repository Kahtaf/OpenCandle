import { describe, expect, it } from "vitest";
import {
  formatChartPrice,
  formatCompactMoney,
  formatCompactNumber,
  formatMoney,
  formatPrice,
  formatQuantity,
  formatSignedMoneyChange,
} from "../../../gui/web/src/lib/financial-format.js";

describe("shared financial formatting", () => {
  it("formats prices with separators and the instrument currency", () => {
    expect(formatMoney(2160.8, "USD")).toBe("$2,160.80");
    expect(formatMoney(2160.8, "CAD")).toBe("CAD 2,160.80");
    expect(formatMoney(2160.8, "JPY")).toBe("JPY 2,160.80");
    expect(formatPrice(6321.45, null)).toBe("6,321.45");
    expect(formatPrice(420.5, "CAD")).toBe("CAD 420.50");
  });

  it("uses compact notation for large counts and currency values", () => {
    expect(formatCompactNumber(52_700_000)).toBe("52.7M");
    expect(formatCompactMoney(3_000_000_000, "CAD")).toBe("CAD 3.00B");
  });

  it("keeps signed amount and percentage together", () => {
    expect(formatSignedMoneyChange(-904, -17, "USD")).toBe("−$904.00 (−17.0%)");
    expect(formatSignedMoneyChange(1000, 12.5, "CAD")).toBe("+CAD 1,000.00 (+12.5%)");
  });

  it("removes decimal noise from large chart scales", () => {
    expect(formatChartPrice(63_086.42)).toBe("63,086");
    expect(formatChartPrice(216)).toBe("216.00");
    expect(formatChartPrice(216.3)).toBe("216.30");
  });

  it("preserves fractional holding quantities", () => {
    expect(formatQuantity(0.001)).toBe("0.001");
    expect(formatQuantity(0.00000001)).toBe("0.00000001");
    expect(formatQuantity(12.5)).toBe("12.5");
  });

  it("returns a dash for unavailable numeric values", () => {
    expect(formatMoney(Number.NaN, "USD")).toBe("—");
    expect(formatCompactNumber(undefined)).toBe("—");
    expect(formatSignedMoneyChange(null, null, "USD")).toBe("—");
  });
});
