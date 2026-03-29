import { describe, it, expect } from "vitest";
import { computeGreeks } from "../../../src/tools/options/greeks.js";

describe("computeGreeks (Black-Scholes)", () => {
  // Standard test case: ATM call, 30 days to expiry, 30% IV, 5% risk-free
  const atm = { spot: 100, strike: 100, timeYears: 30 / 365, iv: 0.30, riskFreeRate: 0.05 };

  describe("call options", () => {
    it("ATM call delta is approximately 0.5", () => {
      const g = computeGreeks({ ...atm, type: "call" });
      expect(g.delta).toBeCloseTo(0.53, 1); // ATM call delta ~0.5-0.55
    });

    it("deep ITM call delta approaches 1", () => {
      const g = computeGreeks({ ...atm, type: "call", strike: 50 });
      expect(g.delta).toBeGreaterThan(0.95);
    });

    it("deep OTM call delta approaches 0", () => {
      const g = computeGreeks({ ...atm, type: "call", strike: 200 });
      expect(g.delta).toBeLessThan(0.05);
    });

    it("theta is negative (time decay)", () => {
      const g = computeGreeks({ ...atm, type: "call" });
      expect(g.theta).toBeLessThan(0);
    });

    it("gamma is positive", () => {
      const g = computeGreeks({ ...atm, type: "call" });
      expect(g.gamma).toBeGreaterThan(0);
    });

    it("vega is positive", () => {
      const g = computeGreeks({ ...atm, type: "call" });
      expect(g.vega).toBeGreaterThan(0);
    });

    it("rho is positive for calls", () => {
      const g = computeGreeks({ ...atm, type: "call" });
      expect(g.rho).toBeGreaterThan(0);
    });
  });

  describe("put options", () => {
    it("ATM put delta is approximately -0.5", () => {
      const g = computeGreeks({ ...atm, type: "put" });
      expect(g.delta).toBeCloseTo(-0.47, 1); // ATM put delta ~-0.5 to -0.45
    });

    it("deep ITM put delta approaches -1", () => {
      const g = computeGreeks({ ...atm, type: "put", strike: 200 });
      expect(g.delta).toBeLessThan(-0.95);
    });

    it("deep OTM put delta approaches 0", () => {
      const g = computeGreeks({ ...atm, type: "put", strike: 50 });
      expect(g.delta).toBeGreaterThan(-0.05);
    });

    it("rho is negative for puts", () => {
      const g = computeGreeks({ ...atm, type: "put" });
      expect(g.rho).toBeLessThan(0);
    });

    it("gamma equals call gamma (same for puts and calls)", () => {
      const callG = computeGreeks({ ...atm, type: "call" });
      const putG = computeGreeks({ ...atm, type: "put" });
      expect(putG.gamma).toBeCloseTo(callG.gamma, 10);
    });

    it("vega equals call vega", () => {
      const callG = computeGreeks({ ...atm, type: "call" });
      const putG = computeGreeks({ ...atm, type: "put" });
      expect(putG.vega).toBeCloseTo(callG.vega, 10);
    });
  });

  describe("edge cases", () => {
    it("handles very short time to expiry", () => {
      const g = computeGreeks({ ...atm, type: "call", timeYears: 1 / 365 });
      expect(Number.isFinite(g.delta)).toBe(true);
      expect(Number.isFinite(g.gamma)).toBe(true);
      expect(Number.isFinite(g.theta)).toBe(true);
    });

    it("handles zero time to expiry (returns intrinsic)", () => {
      const g = computeGreeks({ ...atm, type: "call", timeYears: 0 });
      // ITM: delta should be 1, gamma/theta/vega should be 0
      expect(g.delta).toBe(1); // ATM treated as ITM at expiry
      expect(g.gamma).toBe(0);
      expect(g.vega).toBe(0);
    });

    it("handles very low IV", () => {
      const g = computeGreeks({ ...atm, type: "call", iv: 0.01 });
      expect(Number.isFinite(g.delta)).toBe(true);
    });
  });
});
