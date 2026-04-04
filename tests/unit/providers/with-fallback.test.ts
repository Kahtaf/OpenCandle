import { describe, it, expect, afterEach } from "vitest";
import { withFallback } from "../../../src/providers/with-fallback.js";
import { ProviderTracker } from "../../../src/runtime/provider-tracker.js";
import {
  setRunContext,
  clearRunContext,
} from "../../../src/runtime/run-context.js";

afterEach(() => {
  clearRunContext();
});

describe("withFallback", () => {
  it("returns primary result when it succeeds", async () => {
    const result = await withFallback([
      { provider: "yahoo", fn: async () => ({ price: 185 }) },
      { provider: "alphavantage", fn: async () => ({ price: 184 }) },
    ]);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toEqual({ price: 185 });
    }
  });

  it("falls back when primary fails", async () => {
    const result = await withFallback([
      { provider: "yahoo", fn: async () => { throw new Error("503"); } },
      { provider: "alphavantage", fn: async () => ({ price: 184 }) },
    ]);

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toEqual({ price: 184 });
    }
  });

  it("returns unavailable when all providers fail", async () => {
    const result = await withFallback([
      { provider: "yahoo", fn: async () => { throw new Error("503"); } },
      { provider: "alphavantage", fn: async () => { throw new Error("429"); } },
    ]);

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toContain("yahoo");
      expect(result.reason).toContain("alphavantage");
    }
  });

  it("skips circuit-open providers", async () => {
    const tracker = new ProviderTracker(1);
    tracker.recordFailure("yahoo"); // circuit open
    setRunContext({ providerTracker: tracker });

    let yahooCalled = false;
    const result = await withFallback([
      { provider: "yahoo", fn: async () => { yahooCalled = true; return { price: 185 }; } },
      { provider: "alphavantage", fn: async () => ({ price: 184 }) },
    ]);

    expect(yahooCalled).toBe(false);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toEqual({ price: 184 });
    }
  });

  it("returns unavailable when all providers are circuit-open", async () => {
    const tracker = new ProviderTracker(1);
    tracker.recordFailure("yahoo");
    tracker.recordFailure("alphavantage");
    setRunContext({ providerTracker: tracker });

    const result = await withFallback([
      { provider: "yahoo", fn: async () => ({ price: 185 }) },
      { provider: "alphavantage", fn: async () => ({ price: 184 }) },
    ]);

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toContain("circuit-open");
    }
  });

  it("works without run context (no tracker)", async () => {
    // No setRunContext — ad-hoc usage outside a workflow
    const result = await withFallback([
      { provider: "yahoo", fn: async () => { throw new Error("fail"); } },
      { provider: "alphavantage", fn: async () => ({ price: 184 }) },
    ]);

    expect(result.status).toBe("ok");
  });
});
