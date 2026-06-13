import { describe, expect, it } from "vitest";
import {
  buildPredictionScorecard,
  predictionProgress,
} from "../../../gui/web/src/features/market-state/prediction-view-model.js";

describe("predictionProgress", () => {
  it("measures bullish progress from entry toward target", () => {
    expect(
      predictionProgress({
        direction: "bullish",
        entryPrice: 100,
        targetPrice: 120,
        currentPrice: 110,
      }),
    ).toEqual({ percent: 50, targetHit: false, directionCorrect: true });
  });

  it("clamps to 100 and flags target hit", () => {
    expect(
      predictionProgress({
        direction: "bullish",
        entryPrice: 100,
        targetPrice: 120,
        currentPrice: 130,
      }),
    ).toEqual({ percent: 100, targetHit: true, directionCorrect: true });
  });

  it("measures bearish progress downward and flags wrong-way moves", () => {
    expect(
      predictionProgress({
        direction: "bearish",
        entryPrice: 100,
        targetPrice: 80,
        currentPrice: 90,
      }),
    ).toEqual({ percent: 50, targetHit: false, directionCorrect: true });
    expect(
      predictionProgress({
        direction: "bearish",
        entryPrice: 100,
        targetPrice: 80,
        currentPrice: 105,
      }),
    ).toEqual({ percent: 0, targetHit: false, directionCorrect: false });
  });

  it("returns null when target or current price is missing", () => {
    expect(
      predictionProgress({
        direction: "bullish",
        entryPrice: 100,
        targetPrice: null,
        currentPrice: 110,
      }),
    ).toBeNull();
    expect(
      predictionProgress({
        direction: "bullish",
        entryPrice: 100,
        targetPrice: 120,
        currentPrice: null,
      }),
    ).toBeNull();
  });
});

describe("buildPredictionScorecard", () => {
  it("summarizes open count, resolved hit rate, and average winning move", () => {
    const card = buildPredictionScorecard([
      { status: "open", expiresAt: "2026-07-27T00:00:00Z" },
      { status: "open", expiresAt: "2026-09-10T00:00:00Z" },
      {
        status: "resolved",
        resultJson: JSON.stringify({ currentPrice: 120, pnlPercent: 20, correct: true }),
      },
      {
        status: "resolved",
        resultJson: JSON.stringify({ currentPrice: 95, pnlPercent: 10, correct: true }),
      },
      {
        status: "expired",
        resultJson: JSON.stringify({ currentPrice: 90, pnlPercent: -10, correct: false }),
      },
      { status: "cancelled" },
    ]);

    expect(card.openCount).toBe(2);
    expect(card.resolvedCount).toBe(3);
    expect(card.hitRatePercent).toBeCloseTo((2 / 3) * 100, 5);
    expect(card.avgHitPnlPercent).toBeCloseTo(15, 5);
    expect(card.nextExpiry).toBe("2026-07-27T00:00:00Z");
  });

  it("reports no hit rate until something resolved", () => {
    const card = buildPredictionScorecard([{ status: "open", expiresAt: "2026-07-01T00:00:00Z" }]);
    expect(card.resolvedCount).toBe(0);
    expect(card.hitRatePercent).toBeNull();
  });
});
