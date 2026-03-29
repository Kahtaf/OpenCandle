import { describe, it, expect } from "vitest";
import { computeCorrelation } from "../../../src/tools/portfolio/correlation.js";

describe("computeCorrelation", () => {
  it("returns 1.0 for perfectly correlated data", () => {
    const a = [0.01, 0.02, -0.01, 0.03, -0.02];
    const b = [0.01, 0.02, -0.01, 0.03, -0.02]; // identical
    expect(computeCorrelation(a, b)).toBeCloseTo(1.0, 5);
  });

  it("returns -1.0 for perfectly inversely correlated data", () => {
    const a = [0.01, 0.02, -0.01, 0.03, -0.02];
    const b = [-0.01, -0.02, 0.01, -0.03, 0.02]; // exact opposite
    expect(computeCorrelation(a, b)).toBeCloseTo(-1.0, 5);
  });

  it("returns near 0 for uncorrelated data", () => {
    // Alternating patterns that cancel out
    const a = [0.01, -0.01, 0.01, -0.01, 0.01, -0.01, 0.01, -0.01];
    const b = [0.01, 0.01, -0.01, -0.01, 0.01, 0.01, -0.01, -0.01];
    const r = computeCorrelation(a, b);
    expect(Math.abs(r)).toBeLessThan(0.5);
  });

  it("returns 0 when one series has zero variance", () => {
    const a = [0.01, 0.01, 0.01, 0.01];
    const b = [0.01, 0.02, -0.01, 0.03];
    expect(computeCorrelation(a, b)).toBe(0);
  });

  it("handles arrays of different lengths by using the shorter", () => {
    const a = [0.01, 0.02, -0.01, 0.03, -0.02, 0.01, 0.04];
    const b = [0.01, 0.02, -0.01, 0.03, -0.02];
    const r = computeCorrelation(a, b);
    // Should use first 5 elements, which are identical → 1.0
    expect(r).toBeCloseTo(1.0, 5);
  });

  it("returns a value between -1 and 1", () => {
    const a = [0.05, -0.03, 0.02, 0.01, -0.04, 0.03];
    const b = [0.02, 0.01, -0.02, 0.04, -0.01, 0.02];
    const r = computeCorrelation(a, b);
    expect(r).toBeGreaterThanOrEqual(-1);
    expect(r).toBeLessThanOrEqual(1);
  });
});
