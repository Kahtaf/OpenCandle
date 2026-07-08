import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { getSeries } from "../../../src/providers/fred.js";

const metaFixture = {
  seriess: [
    {
      id: "FEDFUNDS",
      title: "Federal Funds Effective Rate",
      units: "Percent",
      frequency: "Monthly",
      last_updated: "2024-04-01",
    },
  ],
};

const obsFixture = {
  observations: [
    { date: "2024-04-01", value: "." }, // missing value marker — API returns desc order
    { date: "2024-03-01", value: "5.33" },
    { date: "2024-02-01", value: "5.33" },
    { date: "2024-01-01", value: "5.33" },
  ],
};

describe("fred provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns FredSeries with parsed observations", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/series?")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(metaFixture) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(obsFixture) });
    });

    const series = await getSeries("FEDFUNDS", "test-key", 30);
    expect(series.id).toBe("FEDFUNDS");
    expect(series.title).toBe("Federal Funds Effective Rate");
    expect(series.units).toBe("Percent");
    expect(series.observations).toHaveLength(3); // "." value filtered out
    expect(series.observations[0].value).toBe(5.33);
    expect(series.observations[0].date).toBe("2024-01-01");
  });

  it("filters out missing values (dots)", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/series?")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(metaFixture) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(obsFixture) });
    });

    const series = await getSeries("FEDFUNDS", "test-key");
    // The "." entry should be filtered out
    expect(series.observations.every((o) => !Number.isNaN(o.value))).toBe(true);
  });

  it("caches results", async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/series?")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(metaFixture) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve(obsFixture) });
    });

    await getSeries("FEDFUNDS", "test-key", 30);
    await getSeries("FEDFUNDS", "test-key", 30);
    expect(fetch).toHaveBeenCalledTimes(2); // 2 calls for first request (meta + obs), 0 for second
  });

  it("throws ProviderCredentialError with reason=stale on 401", async () => {
    const { ProviderCredentialError } = await import(
      "../../../src/providers/provider-credential-error.js"
    );
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: () => Promise.resolve("Unauthorized"),
    });

    try {
      await getSeries("FEDFUNDS", "bad-key", 30);
      throw new Error("expected ProviderCredentialError");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderCredentialError);
      const credErr = err as InstanceType<typeof ProviderCredentialError>;
      expect(credErr.provider).toBe("fred");
      expect(credErr.reason).toBe("stale");
      expect(credErr.httpStatus).toBe(401);
    }
  });

  it("does NOT treat 400 as a credential error (FRED returns 400 for bad series ids)", async () => {
    const { ProviderCredentialError } = await import(
      "../../../src/providers/provider-credential-error.js"
    );
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: () =>
        Promise.resolve('{"error_message":"Bad Request.  Variable series_id is not valid"}'),
    });

    try {
      await getSeries("NOT_A_SERIES", "test-key", 30);
      throw new Error("expected some error to be thrown");
    } catch (err) {
      // Must NOT be misclassified — 400 is a bad-series-id error, not credentials.
      expect(err).not.toBeInstanceOf(ProviderCredentialError);
    }
  });
});
