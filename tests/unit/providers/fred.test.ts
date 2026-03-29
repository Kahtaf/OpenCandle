import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSeries } from "../../../src/providers/fred.js";
import { cache } from "../../../src/infra/cache.js";

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
    expect(series.observations.every((o) => !isNaN(o.value))).toBe(true);
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
});
