import { afterEach, describe, expect, it } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { InvalidSymbolError } from "../../../src/providers/errors.js";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import { ProviderTracker } from "../../../src/runtime/provider-tracker.js";
import { clearRunContext, setRunContext } from "../../../src/runtime/run-context.js";

afterEach(() => {
  clearRunContext();
  cache.clear();
});

describe("wrapProvider", () => {
  it("returns ok result on success", async () => {
    const result = await wrapProvider("yahoo", async () => ({ price: 185 }));
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toEqual({ price: 185 });
      expect(result.timestamp).toBeTruthy();
    }
  });

  it("returns unavailable on thrown error", async () => {
    const result = await wrapProvider("yahoo", async () => {
      throw new Error("HTTP 503 Service Unavailable");
    });
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("HTTP 503 Service Unavailable");
      expect(result.provider).toBe("yahoo");
    }
  });

  it("returns unavailable without calling fn when circuit is open", async () => {
    const tracker = new ProviderTracker(1);
    tracker.recordFailure("alphavantage");
    setRunContext({ providerTracker: tracker });

    let called = false;
    const result = await wrapProvider("alphavantage", async () => {
      called = true;
      return { data: "should not reach" };
    });

    expect(called).toBe(false);
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("provider_circuit_open");
      expect(result.provider).toBe("alphavantage");
    }
  });

  it("records failure on tracker when provider throws", async () => {
    const tracker = new ProviderTracker(2);
    setRunContext({ providerTracker: tracker });

    await wrapProvider("yahoo", async () => {
      throw new Error("timeout");
    });

    expect(tracker.isCircuitOpen("yahoo")).toBe(false); // 1 failure, threshold 2

    await wrapProvider("yahoo", async () => {
      throw new Error("timeout again");
    });

    expect(tracker.isCircuitOpen("yahoo")).toBe(true); // 2 failures, circuit open
  });

  it("does not record invalid symbols as provider failures", async () => {
    const tracker = new ProviderTracker(1);
    setRunContext({ providerTracker: tracker });

    const result = await wrapProvider("yahoo", async () => {
      throw new InvalidSymbolError("XXFAKEXX", "yahoo");
    });

    expect(result).toMatchObject({
      status: "unavailable",
      provider: "yahoo",
    });
    expect(tracker.isCircuitOpen("yahoo")).toBe(false);
  });

  it("works without run context (no tracker present)", async () => {
    // No setRunContext — tools called outside a workflow
    const result = await wrapProvider("yahoo", async () => ({ price: 100 }));
    expect(result.status).toBe("ok");

    const failResult = await wrapProvider("yahoo", async () => {
      throw new Error("fail");
    });
    expect(failResult.status).toBe("unavailable");
  });

  it("keeps stale cache metadata scoped to the provider call that observed it", async () => {
    const cachedAt = Date.now() - 500;
    cache.set("quote:stale", { price: 101 }, -1);

    const staleCall = wrapProvider("yahoo", async () => {
      const stale = cache.getStale<{ price: number }>("quote:stale", 60_000);
      await new Promise((resolve) => setTimeout(resolve, 5));
      return stale?.value ?? { price: 0 };
    });

    const freshCall = wrapProvider("alphavantage", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return { price: 202 };
    });

    const [staleResult, freshResult] = await Promise.all([staleCall, freshCall]);

    expect(staleResult.status).toBe("ok");
    expect(freshResult.status).toBe("ok");
    if (staleResult.status === "ok" && freshResult.status === "ok") {
      expect(staleResult.stale).toBe(true);
      expect(new Date(staleResult.timestamp).getTime()).toBeGreaterThanOrEqual(cachedAt);
      expect(freshResult.stale).toBeUndefined();
    }
  });
});
