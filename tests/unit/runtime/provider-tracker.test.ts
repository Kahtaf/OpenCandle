import { describe, it, expect } from "vitest";
import { ProviderTracker } from "../../../src/runtime/provider-tracker.js";

describe("ProviderTracker", () => {
  it("circuit is closed initially", () => {
    const tracker = new ProviderTracker(2);
    expect(tracker.isCircuitOpen("alpha-vantage")).toBe(false);
  });

  it("circuit opens after reaching failure threshold", () => {
    const tracker = new ProviderTracker(2);
    tracker.recordFailure("alpha-vantage");
    expect(tracker.isCircuitOpen("alpha-vantage")).toBe(false);
    tracker.recordFailure("alpha-vantage");
    expect(tracker.isCircuitOpen("alpha-vantage")).toBe(true);
  });

  it("different providers are tracked independently", () => {
    const tracker = new ProviderTracker(2);
    tracker.recordFailure("alpha-vantage");
    tracker.recordFailure("alpha-vantage");
    expect(tracker.isCircuitOpen("alpha-vantage")).toBe(true);
    expect(tracker.isCircuitOpen("yahoo-finance")).toBe(false);
  });

  it("shortCircuit returns unavailable result with circuit_open reason", () => {
    const tracker = new ProviderTracker(1);
    const result = tracker.shortCircuit("alpha-vantage");
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("provider_circuit_open");
      expect(result.provider).toBe("alpha-vantage");
    }
  });

  it("reset clears failures for a specific provider", () => {
    const tracker = new ProviderTracker(2);
    tracker.recordFailure("alpha-vantage");
    tracker.recordFailure("alpha-vantage");
    expect(tracker.isCircuitOpen("alpha-vantage")).toBe(true);
    tracker.reset("alpha-vantage");
    expect(tracker.isCircuitOpen("alpha-vantage")).toBe(false);
  });

  it("resetAll clears all tracked failures", () => {
    const tracker = new ProviderTracker(1);
    tracker.recordFailure("alpha-vantage");
    tracker.recordFailure("yahoo-finance");
    tracker.resetAll();
    expect(tracker.isCircuitOpen("alpha-vantage")).toBe(false);
    expect(tracker.isCircuitOpen("yahoo-finance")).toBe(false);
  });

  it("uses default threshold of 2", () => {
    const tracker = new ProviderTracker();
    tracker.recordFailure("test");
    expect(tracker.isCircuitOpen("test")).toBe(false);
    tracker.recordFailure("test");
    expect(tracker.isCircuitOpen("test")).toBe(true);
  });
});
