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

  it("contains all existing twitter provider bullish terms", () => {
    const twitterBullish = [
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
    for (const term of twitterBullish) {
      expect(BULLISH_TERMS).toContain(term);
    }
  });

  it("contains all existing twitter provider bearish terms", () => {
    const twitterBearish = [
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
    for (const term of twitterBearish) {
      expect(BEARISH_TERMS).toContain(term);
    }
  });

  it("contains all existing reddit provider bullish terms", () => {
    const redditBullish = [
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
    for (const term of redditBullish) {
      expect(BULLISH_TERMS).toContain(term);
    }
  });

  it("contains all existing reddit provider bearish terms", () => {
    const redditBearish = [
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
    for (const term of redditBearish) {
      expect(BEARISH_TERMS).toContain(term);
    }
  });
});
