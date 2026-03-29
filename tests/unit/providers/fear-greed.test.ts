import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getFearGreedIndex } from "../../../src/providers/fear-greed.js";
import { cache } from "../../../src/infra/cache.js";
import fixture from "../../fixtures/coingecko/fear-greed.json";

describe("fear-greed provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
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
