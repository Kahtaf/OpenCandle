import { describe, expect, it } from "vitest";
import { BEARISH_TERMS, BULLISH_TERMS } from "../../../src/sentiment/keywords.js";

describe("shared keyword lists", () => {
  it("bullish terms are non-empty", () => {
    expect(BULLISH_TERMS.length).toBeGreaterThan(0);
  });

  it("bearish terms are non-empty", () => {
    expect(BEARISH_TERMS.length).toBeGreaterThan(0);
  });

  it("bullish terms have no duplicates", () => {
    expect(new Set(BULLISH_TERMS).size).toBe(BULLISH_TERMS.length);
  });

  it("bearish terms have no duplicates", () => {
    expect(new Set(BEARISH_TERMS).size).toBe(BEARISH_TERMS.length);
  });

  it("preserves the shared bullish vocabulary", () => {
    const bullishTerms = [
      "moon",
      "buy",
      "undervalued",
      "breakout",
      "calls",
      "bullish",
      "rocket",
      "diamond hands",
      "accumulate",
      "dip buy",
      "long",
      "rip",
      "squeeze",
    ];
    for (const term of bullishTerms) {
      expect(BULLISH_TERMS).toContain(term);
    }
  });

  it("preserves the shared bearish vocabulary", () => {
    const bearishTerms = [
      "crash",
      "overvalued",
      "sell",
      "puts",
      "bearish",
      "bubble",
      "dump",
      "short",
      "bagholding",
      "exit",
      "drill",
      "tank",
      "rug",
    ];
    for (const term of bearishTerms) {
      expect(BEARISH_TERMS).toContain(term);
    }
  });
});
