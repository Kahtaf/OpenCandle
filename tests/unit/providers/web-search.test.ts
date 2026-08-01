import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";
import ddgGeneralFixture from "../../fixtures/web-search/ddg-general.json";
import ddgNewsFixture from "../../fixtures/web-search/ddg-news.json";

// Mock ddg-kit
vi.mock("ddg-kit", () => ({
  search: vi.fn(),
  searchNews: vi.fn(),
  SafeSearchType: { STRICT: 0, MODERATE: -1, OFF: -2 },
  SearchTimeType: { ALL: "a", DAY: "d", WEEK: "w", MONTH: "m", YEAR: "y" },
}));

import { SearchTimeType, search, searchNews } from "ddg-kit";
import { getConfig } from "../../../src/config.js";
import { httpGet } from "../../../src/infra/http-client.js";
import { exaSearch } from "../../../src/providers/exa-search.js";
import {
  braveSearch,
  ddgSearch,
  normalizeFinancialQuery,
  searchWeb,
} from "../../../src/providers/web-search.js";
import braveGeneralFixture from "../../fixtures/web-search/brave-general.json";
import braveNewsFixture from "../../fixtures/web-search/brave-news.json";

vi.mock("../../../src/infra/http-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/infra/http-client.js")>();
  return { ...actual, httpGet: vi.fn() };
});
vi.mock("../../../src/config.js", () => ({
  getConfig: vi.fn(() => ({})),
}));
vi.mock("../../../src/providers/exa-search.js", () => ({
  exaSearch: vi.fn(),
}));
const mockedHttpGet = vi.mocked(httpGet);
const mockedGetConfig = vi.mocked(getConfig);
const mockedExaSearch = vi.mocked(exaSearch);

const mockedSearch = vi.mocked(search);
const mockedSearchNews = vi.mocked(searchNews);

describe("normalizeFinancialQuery", () => {
  it("appends 'stock news' to bare tickers", () => {
    expect(normalizeFinancialQuery("AAPL", "news")).toBe("AAPL stock news");
    expect(normalizeFinancialQuery("NVDA", "news")).toBe("NVDA stock news");
    expect(normalizeFinancialQuery("A", "news")).toBe("A stock news");
  });

  it("strips $ and appends 'stock news' to cashtags", () => {
    expect(normalizeFinancialQuery("$TSLA", "news")).toBe("TSLA stock news");
    expect(normalizeFinancialQuery("$AAPL", "news")).toBe("AAPL stock news");
  });

  it("passes free-form queries unchanged", () => {
    expect(normalizeFinancialQuery("AAPL earnings call", "news")).toBe("AAPL earnings call");
    expect(normalizeFinancialQuery("Fed rate decision impact on banks", "news")).toBe(
      "Fed rate decision impact on banks",
    );
    expect(normalizeFinancialQuery("what is a SPAC", "news")).toBe("what is a SPAC");
  });

  it("does not normalize when category is general", () => {
    expect(normalizeFinancialQuery("AAPL", "general")).toBe("AAPL");
    expect(normalizeFinancialQuery("$TSLA", "general")).toBe("$TSLA");
    expect(normalizeFinancialQuery("CPI", "general")).toBe("CPI");
  });

  it("does not modify lowercase or mixed-case short strings", () => {
    expect(normalizeFinancialQuery("aapl", "news")).toBe("aapl");
    expect(normalizeFinancialQuery("Hello", "news")).toBe("Hello");
  });
});

describe("ddgSearch", () => {
  beforeEach(() => {
    cache.clear();
    vi.clearAllMocks();
    // Give tests plenty of rate-limit tokens so they don't block
    rateLimiter.configure("ddg", 100, 100);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls searchNews for category 'news'", async () => {
    mockedSearchNews.mockResolvedValue(ddgNewsFixture as any);

    const result = await ddgSearch("AAPL stock news", {
      category: "news",
      freshness: "day",
      limit: 10,
    });

    expect(mockedSearchNews).toHaveBeenCalledTimes(1);
    expect(mockedSearch).not.toHaveBeenCalled();
    expect(result.provider).toBe("ddg");
    expect(result.resultCount).toBe(3);
  });

  it("calls search for category 'general'", async () => {
    mockedSearch.mockResolvedValue(ddgGeneralFixture as any);

    const result = await ddgSearch("AAPL stock news", {
      category: "general",
      freshness: "day",
      limit: 10,
    });

    expect(mockedSearch).toHaveBeenCalledTimes(1);
    expect(mockedSearchNews).not.toHaveBeenCalled();
    expect(result.provider).toBe("ddg");
    expect(result.resultCount).toBe(3);
  });

  it("maps freshness to SearchTimeType enums", async () => {
    mockedSearchNews.mockResolvedValue(ddgNewsFixture as any);

    await ddgSearch("test", { category: "news", freshness: "day", limit: 10 });
    expect(mockedSearchNews).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({ time: SearchTimeType.DAY }),
      undefined,
    );

    mockedSearchNews.mockClear();
    await ddgSearch("test", { category: "news", freshness: "week", limit: 10 });
    expect(mockedSearchNews).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({ time: SearchTimeType.WEEK }),
      undefined,
    );

    mockedSearchNews.mockClear();
    await ddgSearch("test", { category: "news", freshness: "month", limit: 10 });
    expect(mockedSearchNews).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({ time: SearchTimeType.MONTH }),
      undefined,
    );
  });

  it("maps 'hours' freshness to DAY (closest available)", async () => {
    mockedSearchNews.mockResolvedValue(ddgNewsFixture as any);

    await ddgSearch("test", { category: "news", freshness: "hours", limit: 10 });
    expect(mockedSearchNews).toHaveBeenCalledWith(
      "test",
      expect.objectContaining({ time: SearchTimeType.DAY }),
      undefined,
    );
  });

  it("maps general search results to WebSearchResult", async () => {
    mockedSearch.mockResolvedValue(ddgGeneralFixture as any);

    const result = await ddgSearch("AAPL", {
      category: "general",
      freshness: "day",
      limit: 10,
    });

    expect(result.results[0]).toEqual({
      title: "Apple Q1 2026 Earnings Beat Expectations",
      url: "https://www.reuters.com/technology/apple-earnings-q1-2026",
      snippet: "Apple reported revenue of $124.3B, beating analyst estimates of $118B...", // HTML tags stripped from description
      source: "reuters.com",
      published: null,
      category: "general",
    });
  });

  it("maps news results to WebSearchResult with ISO dates", async () => {
    mockedSearchNews.mockResolvedValue(ddgNewsFixture as any);

    const result = await ddgSearch("AAPL", {
      category: "news",
      freshness: "day",
      limit: 10,
    });

    const first = result.results[0];
    expect(first.title).toBe("Apple Q1 Earnings Top Estimates With Record Revenue");
    expect(first.source).toBe("Reuters");
    expect(first.category).toBe("news");
    // date is unix timestamp 1712764800 → should be ISO string
    expect(first.published).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("extracts domain from URL for general results", async () => {
    mockedSearch.mockResolvedValue(ddgGeneralFixture as any);

    const result = await ddgSearch("test", {
      category: "general",
      freshness: "day",
      limit: 10,
    });

    expect(result.results[0].source).toBe("reuters.com");
    expect(result.results[1].source).toBe("cnbc.com");
    expect(result.results[2].source).toBe("finance.yahoo.com");
  });

  it("returns empty envelope when DDG returns noResults", async () => {
    mockedSearch.mockResolvedValue({
      noResults: true,
      vqd: "4-000",
      results: [],
    } as any);

    const result = await ddgSearch("xyznonexistent", {
      category: "general",
      freshness: "day",
      limit: 10,
    });

    expect(result.resultCount).toBe(0);
    expect(result.results).toEqual([]);
  });

  it("returns cached results within TTL", async () => {
    mockedSearchNews.mockResolvedValue(ddgNewsFixture as any);

    const first = await ddgSearch("AAPL stock news", {
      category: "news",
      freshness: "day",
      limit: 10,
    });
    const second = await ddgSearch("AAPL stock news", {
      category: "news",
      freshness: "day",
      limit: 10,
    });

    expect(mockedSearchNews).toHaveBeenCalledTimes(1);
    expect(second.resultCount).toBe(first.resultCount);
  });

  it("throws on DDG anomaly detection (rate limit)", async () => {
    mockedSearch.mockRejectedValue(
      new Error(
        "DDG detected an anomaly in the request, you are likely making requests too quickly.",
      ),
    );

    await expect(
      ddgSearch("test", { category: "general", freshness: "day", limit: 10 }),
    ).rejects.toThrow("DDG detected an anomaly");
  });

  it("falls back to stale cache on error", async () => {
    mockedSearchNews.mockResolvedValue(ddgNewsFixture as any);
    // First call populates cache
    await ddgSearch("AAPL stock news", { category: "news", freshness: "day", limit: 10 });

    // Expire the TTL manually
    cache.clear();
    // Re-set as stale (expired TTL but within stale limit)
    cache.store.set("web:ddg:AAPL stock news:news:day:10", {
      value: {
        query: "AAPL stock news",
        results: [],
        resultCount: 0,
        fetchedAt: "2026-04-11T00:00:00Z",
        provider: "ddg",
      },
      expiresAt: Date.now() - 1000, // expired
      cachedAt: Date.now() - 60_000, // 1 min ago (within 1h stale limit)
    });

    mockedSearchNews.mockRejectedValue(new Error("DDG rate limited"));

    const result = await ddgSearch("AAPL stock news", {
      category: "news",
      freshness: "day",
      limit: 10,
    });
    expect(result.resultCount).toBe(0); // stale data
  });

  it("strips HTML bold tags from descriptions", async () => {
    mockedSearch.mockResolvedValue(ddgGeneralFixture as any);

    const result = await ddgSearch("test", {
      category: "general",
      freshness: "day",
      limit: 10,
    });

    // rawDescription is used, not description with <b> tags
    expect(result.results[0].snippet).not.toContain("<b>");
    expect(result.results[0].snippet).not.toContain("</b>");
  });
});

describe("braveSearch", () => {
  beforeEach(() => {
    cache.clear();
    vi.clearAllMocks();
    rateLimiter.configure("brave_search", 100, 100);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls news endpoint for category 'news'", async () => {
    mockedHttpGet.mockResolvedValue(braveNewsFixture);

    await braveSearch("AAPL", { category: "news", freshness: "day", limit: 10 }, "test-key");

    expect(mockedHttpGet).toHaveBeenCalledWith(
      expect.stringContaining("api.search.brave.com/res/v1/news/search"),
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Subscription-Token": "test-key" }),
      }),
    );
  });

  it("calls web endpoint for category 'general'", async () => {
    mockedHttpGet.mockResolvedValue(braveGeneralFixture);

    await braveSearch("AAPL", { category: "general", freshness: "day", limit: 10 }, "test-key");

    expect(mockedHttpGet).toHaveBeenCalledWith(
      expect.stringContaining("api.search.brave.com/res/v1/web/search"),
      expect.any(Object),
    );
  });

  it("maps freshness to Brave params", async () => {
    mockedHttpGet.mockResolvedValue(braveNewsFixture);

    await braveSearch("test", { category: "news", freshness: "hours", limit: 10 }, "key");
    expect(mockedHttpGet).toHaveBeenCalledWith(
      expect.stringContaining("freshness=ph"),
      expect.any(Object),
    );

    mockedHttpGet.mockClear();
    await braveSearch("test", { category: "news", freshness: "day", limit: 10 }, "key");
    expect(mockedHttpGet).toHaveBeenCalledWith(
      expect.stringContaining("freshness=pd"),
      expect.any(Object),
    );

    mockedHttpGet.mockClear();
    await braveSearch("test", { category: "news", freshness: "week", limit: 10 }, "key");
    expect(mockedHttpGet).toHaveBeenCalledWith(
      expect.stringContaining("freshness=pw"),
      expect.any(Object),
    );

    mockedHttpGet.mockClear();
    await braveSearch("test", { category: "news", freshness: "month", limit: 10 }, "key");
    expect(mockedHttpGet).toHaveBeenCalledWith(
      expect.stringContaining("freshness=pm"),
      expect.any(Object),
    );
  });

  it("maps news results to WebSearchResult", async () => {
    mockedHttpGet.mockResolvedValue(braveNewsFixture);

    const result = await braveSearch(
      "AAPL",
      { category: "news", freshness: "day", limit: 10 },
      "key",
    );

    expect(result.provider).toBe("brave");
    expect(result.resultCount).toBe(2);
    expect(result.results[0].title).toBe("Apple Reports Record Q1 Revenue, Beats Estimates");
    expect(result.results[0].source).toBe("Reuters");
    expect(result.results[0].category).toBe("news");
  });

  it("maps general results to WebSearchResult", async () => {
    mockedHttpGet.mockResolvedValue(braveGeneralFixture);

    const result = await braveSearch(
      "AAPL",
      { category: "general", freshness: "day", limit: 10 },
      "key",
    );

    expect(result.provider).toBe("brave");
    expect(result.resultCount).toBe(2);
    expect(result.results[0].category).toBe("general");
  });

  it("throws ProviderCredentialError with reason=stale on 401", async () => {
    const { HttpError } = (await import("../../../src/infra/http-client.js")) as any;
    const { ProviderCredentialError } = await import(
      "../../../src/providers/provider-credential-error.js"
    );
    mockedHttpGet.mockRejectedValue(new HttpError(401, "Unauthorized", ""));

    try {
      await braveSearch("test", { category: "news", freshness: "day", limit: 10 }, "bad-key");
      throw new Error("expected ProviderCredentialError to be thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderCredentialError);
      const credErr = err as InstanceType<typeof ProviderCredentialError>;
      expect(credErr.provider).toBe("brave");
      expect(credErr.reason).toBe("stale");
      expect(credErr.httpStatus).toBe(401);
    }
  });

  it("throws on 429 for cascade fallback", async () => {
    const { HttpError } = (await import("../../../src/infra/http-client.js")) as any;
    mockedHttpGet.mockRejectedValue(new HttpError(429, "Too Many Requests", ""));

    await expect(
      braveSearch("test", { category: "news", freshness: "day", limit: 10 }, "key"),
    ).rejects.toThrow();
  });

  it("throws on 5xx for cascade fallback", async () => {
    const { HttpError } = (await import("../../../src/infra/http-client.js")) as any;
    mockedHttpGet.mockRejectedValue(new HttpError(500, "Internal Server Error", ""));

    await expect(
      braveSearch("test", { category: "news", freshness: "day", limit: 10 }, "key"),
    ).rejects.toThrow();
  });

  it("returns cached results within TTL", async () => {
    mockedHttpGet.mockResolvedValue(braveNewsFixture);

    await braveSearch("AAPL", { category: "news", freshness: "day", limit: 10 }, "key");
    await braveSearch("AAPL", { category: "news", freshness: "day", limit: 10 }, "key");

    expect(mockedHttpGet).toHaveBeenCalledTimes(1);
  });
});

describe("searchWeb cascade", () => {
  const exaEnvelope = {
    query: "AAPL stock news",
    results: [
      {
        title: "Exa Result",
        url: "https://exa.com/1",
        snippet: "exa",
        source: "exa.com",
        published: null,
        category: "news" as const,
      },
    ],
    resultCount: 1,
    fetchedAt: "2026-04-11T00:00:00Z",
    provider: "exa" as const,
  };

  beforeEach(() => {
    cache.clear();
    vi.clearAllMocks();
    rateLimiter.configure("ddg", 100, 100);
    rateLimiter.configure("brave_search", 100, 100);
    rateLimiter.configure("exa", 100, 100);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses Exa first when it succeeds (news)", async () => {
    mockedGetConfig.mockReturnValue({ braveApiKey: "my-key" } as any);
    mockedExaSearch.mockResolvedValue(exaEnvelope);

    const result = await searchWeb("AAPL", { category: "news", freshness: "day", limit: 10 });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.provider).toBe("exa");
    }
    // Brave and DDG not called
    expect(mockedHttpGet).not.toHaveBeenCalled();
    expect(mockedSearchNews).not.toHaveBeenCalled();
  });

  it("uses Exa first when it succeeds (general)", async () => {
    mockedGetConfig.mockReturnValue({ braveApiKey: "my-key" } as any);
    mockedExaSearch.mockResolvedValue({
      ...exaEnvelope,
      results: [{ ...exaEnvelope.results[0], category: "general" }],
    });

    const result = await searchWeb("test", { category: "general", freshness: "day", limit: 10 });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.provider).toBe("exa");
    }
    expect(mockedHttpGet).not.toHaveBeenCalled();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("falls back to Brave when Exa fails and Brave key is configured", async () => {
    mockedGetConfig.mockReturnValue({ braveApiKey: "my-key" } as any);
    mockedExaSearch.mockRejectedValue(new Error("Exa timeout"));
    mockedHttpGet.mockResolvedValue(braveNewsFixture);

    const result = await searchWeb("AAPL", { category: "news", freshness: "day", limit: 10 });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.provider).toBe("brave");
    }
    expect(mockedSearchNews).not.toHaveBeenCalled();
  });

  it("falls back to DDG when Exa fails and no Brave key", async () => {
    mockedGetConfig.mockReturnValue({} as any);
    mockedExaSearch.mockRejectedValue(new Error("Exa timeout"));
    mockedSearchNews.mockResolvedValue(ddgNewsFixture as any);

    const result = await searchWeb("AAPL", { category: "news", freshness: "day", limit: 10 });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.provider).toBe("ddg");
    }
  });

  it("falls through entire cascade: Exa → Brave → DDG", async () => {
    mockedGetConfig.mockReturnValue({ braveApiKey: "my-key" } as any);
    mockedExaSearch.mockRejectedValue(new Error("Exa down"));
    mockedHttpGet.mockRejectedValue(new Error("Brave 429"));
    mockedSearchNews.mockResolvedValue(ddgNewsFixture as any);

    const result = await searchWeb("AAPL", { category: "news", freshness: "day", limit: 10 });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.provider).toBe("ddg");
    }
  });

  it("restricts the cascade to explicitly allowed hosted providers", async () => {
    mockedGetConfig.mockReturnValue({ braveApiKey: "my-key" } as any);
    mockedHttpGet.mockResolvedValue(braveNewsFixture);

    const result = await searchWeb("AAPL", {
      category: "news",
      freshness: "day",
      limit: 10,
      allowedProviders: ["brave"],
    });

    expect(result.status).toBe("ok");
    expect(mockedExaSearch).not.toHaveBeenCalled();
    expect(mockedSearchNews).not.toHaveBeenCalled();
  });

  it("rejects a provider override outside the allowed hosted set", async () => {
    const result = await searchWeb("AAPL", {
      category: "news",
      freshness: "day",
      limit: 10,
      provider: "ddg",
      allowedProviders: ["exa"],
    });

    expect(result).toMatchObject({ status: "unavailable", reason: "provider not allowed" });
    expect(mockedExaSearch).not.toHaveBeenCalled();
    expect(mockedSearchNews).not.toHaveBeenCalled();
  });

  it("returns unavailable when all providers fail", async () => {
    mockedGetConfig.mockReturnValue({} as any);
    mockedExaSearch.mockRejectedValue(new Error("Exa down"));
    mockedSearchNews.mockRejectedValue(new Error("DDG down"));

    const result = await searchWeb("test", { category: "news", freshness: "day", limit: 10 });

    expect(result.status).toBe("unavailable");
  });

  it("applies default opts: category news, freshness day, limit 10", async () => {
    mockedGetConfig.mockReturnValue({} as any);
    mockedExaSearch.mockResolvedValue(exaEnvelope);

    const result = await searchWeb("AAPL");

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.provider).toBe("exa");
    }
    expect(mockedExaSearch).toHaveBeenCalledWith(
      "AAPL stock news",
      expect.objectContaining({ category: "news", freshness: "day", limit: 10 }),
    );
  });

  it("normalizes bare ticker queries", async () => {
    mockedGetConfig.mockReturnValue({} as any);
    mockedExaSearch.mockResolvedValue(exaEnvelope);

    const result = await searchWeb("AAPL");

    expect(result.status).toBe("ok");
    expect(mockedExaSearch).toHaveBeenCalledWith("AAPL stock news", expect.any(Object));
  });

  it("provider override: ddg skips Exa entirely", async () => {
    mockedGetConfig.mockReturnValue({} as any);
    mockedSearchNews.mockResolvedValue(ddgNewsFixture as any);

    const result = await searchWeb("AAPL", {
      category: "news",
      freshness: "day",
      limit: 10,
      provider: "ddg",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.provider).toBe("ddg");
    }
    expect(mockedExaSearch).not.toHaveBeenCalled();
  });

  it("provider override: exa skips DDG entirely", async () => {
    mockedGetConfig.mockReturnValue({} as any);
    mockedExaSearch.mockResolvedValue(exaEnvelope);

    const result = await searchWeb("AAPL", {
      category: "news",
      freshness: "day",
      limit: 10,
      provider: "exa",
    });

    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.data.provider).toBe("exa");
    }
    expect(mockedSearchNews).not.toHaveBeenCalled();
    expect(mockedSearch).not.toHaveBeenCalled();
  });

  it("provider override: brave returns unavailable when no key", async () => {
    mockedGetConfig.mockReturnValue({} as any);

    const result = await searchWeb("AAPL", {
      category: "news",
      freshness: "day",
      limit: 10,
      provider: "brave",
    });

    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") {
      expect(result.reason).toMatch(/BRAVE_API_KEY/);
    }
  });
});
