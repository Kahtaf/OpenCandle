import { describe, it, expect, afterEach } from "vitest";
import { ProviderTracker } from "../../../src/runtime/provider-tracker.js";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import {
  setRunContext,
  clearRunContext,
} from "../../../src/runtime/run-context.js";

afterEach(() => {
  clearRunContext();
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

  it("works without run context (no tracker present)", async () => {
    // No setRunContext — tools called outside a workflow
    const result = await wrapProvider("yahoo", async () => ({ price: 100 }));
    expect(result.status).toBe("ok");

    const failResult = await wrapProvider("yahoo", async () => {
      throw new Error("fail");
    });
    expect(failResult.status).toBe("unavailable");
  });
});
