import { describe, expect, it } from "vitest";
import { normalizeCurrencyUnit } from "../../../src/portfolio/currency-unit.js";

describe("explicit currency units", () => {
  it.each([
    ["GBp", "GBP", 0.01],
    ["GBX", "GBP", 0.01],
    ["GBP", "GBP", 1],
    ["EUR", "EUR", 1],
    ["CAD", "CAD", 1],
  ])("normalizes %s without losing scale", (raw, currency, scale) => {
    expect(normalizeCurrencyUnit(raw)).toEqual({ raw, currency, scale });
  });
  it.each([null, undefined, "", "gbp", "ZAc", "ILA", "XYZ"])(
    "rejects missing or ambiguous unit %s",
    (unit) => {
      expect(normalizeCurrencyUnit(unit)).toBeNull();
    },
  );
});
