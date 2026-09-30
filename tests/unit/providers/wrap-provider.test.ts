import { afterEach, describe, expect, it } from "vitest";
import { runWithAbortSignal } from "../../../src/infra/abort-context.js";
import { Cache } from "../../../src/infra/cache.js";
import { ProviderCredentialError } from "../../../src/providers/provider-credential-error.js";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import { ProviderTracker } from "../../../src/runtime/provider-tracker.js";
import { clearRunContext, setRunContext } from "../../../src/runtime/run-context.js";

describe("wrapProvider", () => {
  it("returns ok result on success", async () => {
    const result = await wrapProvider("yahoo-finance", async () => ({
      price: 185.5,
    }));

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toEqual({ price: 185.5 });
      expect(result.timestamp).toBeTruthy();
    }
  });

  it("returns unavailable result on thrown error", async () => {
    const result = await wrapProvider("alpha-vantage", async () => {
      throw new Error("rate_limited");
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("rate_limited");
      expect(result.provider).toBe("alpha-vantage");
    }
  });

  it("handles non-Error throws", async () => {
    const result = await wrapProvider("fred", async () => {
      throw "string_error";
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("unknown_error");
      expect(result.provider).toBe("fred");
    }
  });

  it("re-throws ProviderCredentialError instead of converting it to unavailable", async () => {
    await expect(
      wrapProvider("alpha_vantage", async () => {
        throw new ProviderCredentialError("alpha_vantage", "missing");
      }),
    ).rejects.toBeInstanceOf(ProviderCredentialError);
  });

  it("re-throws ProviderCredentialError even for stale-credential errors", async () => {
    try {
      await wrapProvider("finnhub", async () => {
        throw new ProviderCredentialError("finnhub", "stale", 401);
      });
      throw new Error("expected wrapProvider to re-throw");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderCredentialError);
      const credErr = err as ProviderCredentialError;
      expect(credErr.provider).toBe("finnhub");
      expect(credErr.reason).toBe("stale");
      expect(credErr.httpStatus).toBe(401);
    }
  });

  it("still returns unavailable for non-credential errors (unchanged behavior)", async () => {
    const result = await wrapProvider("alpha_vantage", async () => {
      throw new Error("network timeout");
    });
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toBe("network timeout");
    }
  });

  it("marks fresh cache hits as cached provider results", async () => {
    const cache = new Cache();
    cache.set("quote:AAPL", { price: 185 }, 60_000);

    const result = await wrapProvider("yahoo-finance", async () => cache.get("quote:AAPL"));

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data).toEqual({ price: 185 });
      expect(result.cached).toBe(true);
      expect(result.stale).toBeUndefined();
    }
  });
});

describe("wrapProvider when the user stops the run", () => {
  afterEach(() => clearRunContext());

  it("does not count a Stop-aborted request against the provider's circuit", async () => {
    // A parallel batch of Yahoo calls aborted by one Stop must not open the
    // circuit that the immediate Retry then needs.
    const tracker = new ProviderTracker();
    setRunContext({ providerTracker: tracker });
    const run = new AbortController();
    run.abort();
    const aborted = () =>
      runWithAbortSignal(run.signal, () =>
        wrapProvider("yahoo", () =>
          Promise.reject(new DOMException("This operation was aborted", "AbortError")),
        ),
      );
    await expect(aborted()).rejects.toThrow(/aborted/i);
    await expect(aborted()).rejects.toThrow(/aborted/i);
    expect(tracker.isCircuitOpen("yahoo")).toBe(false);
    await expect(wrapProvider("yahoo", async () => 1)).resolves.toMatchObject({ status: "ok" });
  });

  it("still counts genuine provider failures", async () => {
    const tracker = new ProviderTracker();
    setRunContext({ providerTracker: tracker });
    const run = new AbortController();
    for (let attempt = 0; attempt < 2; attempt++) {
      await runWithAbortSignal(run.signal, () =>
        wrapProvider("yahoo", () => Promise.reject(new Error("HTTP 503"))),
      );
    }
    expect(tracker.isCircuitOpen("yahoo")).toBe(true);
  });
});
