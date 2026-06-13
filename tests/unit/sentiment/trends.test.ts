import { describe, expect, it } from "vitest";
import { computeDivergence, computeTrend, renderSparkline } from "../../../src/sentiment/trends.js";
import type { TrendBucket } from "../../../src/sentiment/types.js";

describe("renderSparkline", () => {
  it("renders ascending then descending pattern", () => {
    const result = renderSparkline([0.1, 0.3, 0.5, 0.9, 0.7, 0.3, 0.1]);
    expect(result.length).toBe(7);
    // Middle should be the highest block
    expect(result[3]).toBe("█");
  });

  it("renders full range from lowest to highest", () => {
    const result = renderSparkline([-1, -0.5, 0, 0.5, 1]);
    expect(result.length).toBe(5);
    expect(result[0]).toBe("▁");
    expect(result[4]).toBe("█");
  });

  it("returns empty string for empty array", () => {
    expect(renderSparkline([])).toBe("");
  });

  it("returns single block for single value", () => {
    const result = renderSparkline([0.5]);
    expect(result.length).toBe(1);
  });

  it("returns same block for all same values", () => {
    const result = renderSparkline([0.5, 0.5, 0.5]);
    expect(result[0]).toBe(result[1]);
    expect(result[1]).toBe(result[2]);
  });
});

describe("computeTrend", () => {
  it("detects rising trend", () => {
    const buckets: TrendBucket[] = [
      { timestamp: "2026-04-05", avgScore: 0.1, count: 10 },
      { timestamp: "2026-04-06", avgScore: 0.3, count: 10 },
      { timestamp: "2026-04-07", avgScore: 0.5, count: 10 },
      { timestamp: "2026-04-08", avgScore: 0.7, count: 10 },
    ];
    const trend = computeTrend(buckets, "twitter");
    expect(trend.direction).toBe("rising");
    expect(trend.delta).toBeGreaterThan(0);
    expect(trend.count).toBe(40);
    expect(trend.sparkline.length).toBe(4);
  });

  it("detects falling trend", () => {
    const buckets: TrendBucket[] = [
      { timestamp: "2026-04-05", avgScore: 0.8, count: 5 },
      { timestamp: "2026-04-06", avgScore: 0.5, count: 5 },
      { timestamp: "2026-04-07", avgScore: 0.2, count: 5 },
    ];
    const trend = computeTrend(buckets, "reddit");
    expect(trend.direction).toBe("falling");
    expect(trend.delta).toBeLessThan(0);
  });

  it("detects stable trend", () => {
    const buckets: TrendBucket[] = [
      { timestamp: "2026-04-05", avgScore: 0.3, count: 5 },
      { timestamp: "2026-04-06", avgScore: 0.31, count: 5 },
      { timestamp: "2026-04-07", avgScore: 0.29, count: 5 },
    ];
    const trend = computeTrend(buckets, "web");
    expect(trend.direction).toBe("stable");
  });

  it("includes sample count", () => {
    const buckets: TrendBucket[] = [{ timestamp: "2026-04-05", avgScore: 0.3, count: 42 }];
    const trend = computeTrend(buckets, "twitter");
    expect(trend.count).toBe(42);
  });
});

describe("computeDivergence", () => {
  it("flags divergence when retail vs news gap exceeds threshold", () => {
    const sources = {
      twitter: { avg: 0.5, count: 10 },
      reddit: { avg: 0.4, count: 10 },
      web: { avg: -0.2, count: 10 },
    };
    const result = computeDivergence(sources, 0.4);
    expect(result.detected).toBe(true);
    expect(result.retailAvg).toBeCloseTo(0.45);
    expect(result.newsAvg).toBeCloseTo(-0.2);
    expect(result.gap).toBeGreaterThan(0.4);
  });

  it("no divergence when sources aligned", () => {
    const sources = {
      twitter: { avg: 0.3, count: 10 },
      reddit: { avg: 0.25, count: 10 },
      web: { avg: 0.2, count: 10 },
    };
    const result = computeDivergence(sources, 0.4);
    expect(result.detected).toBe(false);
  });

  it("skips divergence with insufficient data", () => {
    const sources = {
      twitter: { avg: 0.5, count: 3 },
      reddit: { avg: 0.4, count: 2 },
      web: { avg: -0.3, count: 10 },
    };
    const result = computeDivergence(sources, 0.4);
    expect(result.detected).toBe(false);
    expect(result.message).toContain("Insufficient");
  });
});
