import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { HttpError, httpGet } from "../../../src/infra/http-client.js";
import fixture from "../../fixtures/finnhub/company-news.json";

vi.mock("../../../src/infra/http-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/infra/http-client.js")>();
  return { ...actual, httpGet: vi.fn() };
});

const mockedHttpGet = vi.mocked(httpGet);

const originalFetch = globalThis.fetch;
beforeEach(() => {
  cache.clear();
  vi.clearAllMocks();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("finnhubDateRange", () => {
  it("returns today for 'hours' freshness", async () => {
    const { finnhubDateRange } = await import("../../../src/providers/finnhub.js");
    const { from, to } = finnhubDateRange("hours");
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(from).toBe(to);
  });

  it("returns yesterday to today for 'day' freshness", async () => {
    const { finnhubDateRange } = await import("../../../src/providers/finnhub.js");
    const { from, to } = finnhubDateRange("day");
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(1);
  });

  it("returns 7-day range for 'week' freshness", async () => {
    const { finnhubDateRange } = await import("../../../src/providers/finnhub.js");
    const { from, to } = finnhubDateRange("week");
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(7);
  });

  it("returns 30-day range for 'month' freshness", async () => {
    const { finnhubDateRange } = await import("../../../src/providers/finnhub.js");
    const { from, to } = finnhubDateRange("month");
    const fromDate = new Date(from);
    const toDate = new Date(to);
    const diffDays = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBe(30);
  });
});

describe("getCompanyNews", () => {
  it("returns articles on successful fetch", async () => {
    const { getCompanyNews } = await import("../../../src/providers/finnhub.js");
    mockedHttpGet.mockResolvedValueOnce(fixture);

    const articles = await getCompanyNews("AAPL", "2026-04-10", "2026-04-11", "test-key");

    expect(mockedHttpGet).toHaveBeenCalledWith(expect.stringContaining("symbol=AAPL"));
    expect(articles.length).toBeGreaterThan(0);
    expect(articles[0]).toHaveProperty("headline");
    expect(articles[0]).toHaveProperty("summary");
    expect(articles[0]).toHaveProperty("source");
    expect(articles[0]).toHaveProperty("datetime");
  });

  it("returns empty array when API returns no articles", async () => {
    const { getCompanyNews } = await import("../../../src/providers/finnhub.js");
    mockedHttpGet.mockResolvedValueOnce([]);

    const articles = await getCompanyNews("XYZ", "2026-04-10", "2026-04-11", "test-key");
    expect(articles).toEqual([]);
  });

  it("throws ProviderCredentialError with reason=stale on 401", async () => {
    const { getCompanyNews } = await import("../../../src/providers/finnhub.js");
    const { ProviderCredentialError } = await import(
      "../../../src/providers/provider-credential-error.js"
    );
    mockedHttpGet.mockRejectedValueOnce(new HttpError(401, "Unauthorized"));

    try {
      await getCompanyNews("AAPL", "2026-04-10", "2026-04-11", "bad-key");
      throw new Error("expected ProviderCredentialError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderCredentialError);
      const credErr = err as InstanceType<typeof ProviderCredentialError>;
      expect(credErr.provider).toBe("finnhub");
      expect(credErr.reason).toBe("stale");
      expect(credErr.httpStatus).toBe(401);
    }
  });

  it("throws ProviderCredentialError with reason=stale on 403", async () => {
    const { getCompanyNews } = await import("../../../src/providers/finnhub.js");
    const { ProviderCredentialError } = await import(
      "../../../src/providers/provider-credential-error.js"
    );
    mockedHttpGet.mockRejectedValueOnce(new HttpError(403, "Forbidden"));

    await expect(
      getCompanyNews("AAPL", "2026-04-10", "2026-04-11", "bad-key"),
    ).rejects.toBeInstanceOf(ProviderCredentialError);
  });

  it("throws on 429 (rate limited)", async () => {
    const { getCompanyNews } = await import("../../../src/providers/finnhub.js");
    mockedHttpGet.mockRejectedValueOnce(new HttpError(429, "Too Many Requests"));

    await expect(getCompanyNews("AAPL", "2026-04-10", "2026-04-11", "test-key")).rejects.toThrow();
  });

  it("returns stale cache on failure when available", async () => {
    const { getCompanyNews } = await import("../../../src/providers/finnhub.js");
    // Prime cache
    mockedHttpGet.mockResolvedValueOnce(fixture);
    await getCompanyNews("AAPL", "2026-04-10", "2026-04-11", "test-key");

    // Expire the cache
    cache.clear();
    // Manually insert a stale entry
    cache.set("finnhub:news:AAPL:2026-04-10:2026-04-11", fixture.slice(0, 3), 1); // TTL 1ms
    await new Promise((r) => setTimeout(r, 5)); // let it expire

    // Now API fails
    mockedHttpGet.mockRejectedValueOnce(new Error("network error"));

    const articles = await getCompanyNews("AAPL", "2026-04-10", "2026-04-11", "test-key");
    expect(articles.length).toBeGreaterThan(0);
  });

  it("returns cached result within TTL without API call", async () => {
    const { getCompanyNews } = await import("../../../src/providers/finnhub.js");
    mockedHttpGet.mockResolvedValueOnce(fixture);

    await getCompanyNews("AAPL", "2026-04-10", "2026-04-11", "test-key");
    const second = await getCompanyNews("AAPL", "2026-04-10", "2026-04-11", "test-key");

    expect(mockedHttpGet).toHaveBeenCalledTimes(1);
    expect(second.length).toBeGreaterThan(0);
  });
});

describe("relevance filter", () => {
  it("keeps articles mentioning the ticker in headline", async () => {
    const { filterByRelevance } = await import("../../../src/providers/finnhub.js");
    const result = filterByRelevance(fixture, "AAPL");
    const headlines = result.map((a) => a.headline);
    expect(headlines).toContain(
      "2.5 Billion Reasons Apple Might Be the Best AI Stock to Buy Today",
    );
  });

  it("keeps articles mentioning the company name in summary", async () => {
    const { filterByRelevance } = await import("../../../src/providers/finnhub.js");
    const result = filterByRelevance(fixture, "AAPL");
    const ids = result.map((a) => a.id);
    // "Apple Inc. has hired..." in summary
    expect(ids).toContain(139738251);
  });

  it("filters out irrelevant articles", async () => {
    const { filterByRelevance } = await import("../../../src/providers/finnhub.js");
    const result = filterByRelevance(fixture, "AAPL");
    const headlines = result.map((a) => a.headline);
    expect(headlines).not.toContain(
      "VTSAX vs VOO ETF: Which Vanguard Fund Should You Buy in 2026?",
    );
    expect(headlines).not.toContain(
      "Japan Bets $16 Billion to Propel Rapidus in Global AI Chip Race",
    );
    expect(headlines).not.toContain(
      "Gary Black Says Tesla's 8-Week Slide Driven By Disappointing Deliveries",
    );
  });
});

describe("result cap", () => {
  it("caps at 20 results", async () => {
    const { filterByRelevance } = await import("../../../src/providers/finnhub.js");
    // Create 30 relevant articles
    const many = Array.from({ length: 30 }, (_, i) => ({
      ...fixture[0],
      id: 1000 + i,
      datetime: 1775943540 - i * 60,
      headline: `Apple earnings update ${i}`,
    }));
    const result = filterByRelevance(many, "AAPL", 20);
    expect(result.length).toBe(20);
  });

  it("returns all if below cap", async () => {
    const { filterByRelevance } = await import("../../../src/providers/finnhub.js");
    // Only 3 relevant articles in the fixture
    const result = filterByRelevance(fixture, "AAPL", 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.length).toBeGreaterThan(0);
  });
});
