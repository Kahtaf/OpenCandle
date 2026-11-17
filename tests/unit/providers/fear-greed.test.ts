import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import { getFearGreedIndex } from "../../../src/providers/fear-greed.js";
import fixture from "../../fixtures/coingecko/fear-greed.json";

describe("fear-greed provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    rateLimiter.configure("feargreed", 1000, 1000);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns FearGreedData with correct values", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    const fg = await getFearGreedIndex();
    expect(fg.value).toBe(36);
    expect(fg.label).toBe("Fear");
    expect(fg.previousClose).toBe(38);
  });

  it("returns label from API response", async () => {
    const extremeFear = {
      data: [
        { value: "10", value_classification: "Extreme Fear", timestamp: "1711900800" },
        { value: "12", value_classification: "Extreme Fear", timestamp: "1711814400" },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(extremeFear),
    });

    const fg = await getFearGreedIndex();
    expect(fg.value).toBe(10);
    expect(fg.label).toBe("Extreme Fear");
  });

  it("returns Extreme Greed label", async () => {
    const extremeGreed = {
      data: [
        { value: "90", value_classification: "Extreme Greed", timestamp: "1711900800" },
        { value: "85", value_classification: "Greed", timestamp: "1711814400" },
      ],
    };
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(extremeGreed),
    });

    const fg = await getFearGreedIndex();
    expect(fg.value).toBe(90);
    expect(fg.label).toBe("Extreme Greed");
  });

  it("returns null for weekAgo and monthAgo when not available", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    const fg = await getFearGreedIndex();
    expect(fg.weekAgo).toBeNull();
    expect(fg.monthAgo).toBeNull();
  });

  it.each([{}, { data: null }, { data: {} }, { data: [] }])(
    "rejects malformed response %j without caching an observation",
    async (response) => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(response),
      });

      await expect(getFearGreedIndex()).rejects.toThrow("Invalid Fear & Greed response");
      expect(cache.get("feargreed:index")).toBeUndefined();
    },
  );

  it.each([
    { value: "" },
    { value: "NaN" },
    { value: "-1" },
    { value: "101" },
    { value_classification: " " },
    { value_classification: null },
    { timestamp: "" },
    { timestamp: "not-a-date" },
    { timestamp: "-1" },
    { timestamp: "999999999999999" },
  ])("rejects invalid observation %j without inventing a source date", async (invalid) => {
    const response = structuredClone(fixture);
    Object.assign(response.data[0], invalid);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    });

    await expect(getFearGreedIndex()).rejects.toThrow("Invalid Fear & Greed observation");
    expect(cache.get("feargreed:index")).toBeUndefined();
  });

  it("rejects an invalid prior observation instead of reporting a fabricated previous close", async () => {
    const response = structuredClone(fixture);
    response.data[1].value = "not-a-number";
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(response),
    });

    await expect(getFearGreedIndex()).rejects.toThrow("Invalid Fear & Greed observation");
    expect(cache.get("feargreed:index")).toBeUndefined();
  });

  it("preserves the provider observation date independently of retrieval time", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-17T12:00:00Z"));
    rateLimiter.configure("feargreed", 1000, 1000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    const result = await getFearGreedIndex();

    expect(result.asOf).toBe("2024-03-31T16:00:00.000Z");
    expect(result.timestamp).toBe(Date.parse("2026-11-17T12:00:00Z"));
  });

  it("caches results", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    await getFearGreedIndex();
    await getFearGreedIndex();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
