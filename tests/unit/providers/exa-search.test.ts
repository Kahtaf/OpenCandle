import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { rateLimiter } from "../../../src/infra/rate-limiter.js";

vi.mock("../../../src/config.js", () => ({
  getConfig: vi.fn(() => ({})),
}));

import { getConfig } from "../../../src/config.js";
import type { ParsedResult } from "../../../src/providers/exa-search.js";
import {
  enrichQueryForMcp,
  exaSearch,
  extractJsonRpcPayload,
  filterByFreshness,
  mapApiResults,
  parseMcpResultBlocks,
} from "../../../src/providers/exa-search.js";
import apiResponseFixture from "../../fixtures/exa/api-response.json";
import mcpEmptyFixture from "../../fixtures/exa/mcp-empty-response.json";
import mcpErrorFixture from "../../fixtures/exa/mcp-error-response.json";
import mcpJsonFixture from "../../fixtures/exa/mcp-json-response.json";

const mockedGetConfig = vi.mocked(getConfig);

const sseFixture = readFileSync(
  resolve(__dirname, "../../fixtures/exa/mcp-sse-response.txt"),
  "utf-8",
);

// Extract the data line payload from SSE fixture for Content-Type branching tests
const sseDataPayload = sseFixture
  .split("\n")
  .find((l) => l.startsWith("data:"))
  ?.slice(5)
  .trim();

function mockFetchResponse(
  body: string,
  opts?: { contentType?: string; status?: number; headers?: Record<string, string> },
) {
  const status = opts?.status ?? 200;
  const contentType = opts?.contentType ?? "text/event-stream";
  const extraHeaders = opts?.headers ?? {};
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: new Headers({ "content-type": contentType, ...extraHeaders }),
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  });
}

describe("parseMcpResultBlocks", () => {
  it("parses 3 blocks from SSE text", () => {
    const parsed = JSON.parse(sseDataPayload);
    const text = parsed.result.content[0].text;
    const results = parseMcpResultBlocks(text);

    expect(results).toHaveLength(3);
    expect(results[0].title).toBe("Apple Set to Deliver Slight Earnings Miss for March Quarter");
    expect(results[0].url).toBe(
      "https://www.proactiveinvestors.com/companies/news/1090365/apple-earnings-march-quarter.html",
    );
    expect(results[0].published).toBe("2026-04-10T15:46:00.000Z");
    expect(results[0].snippet.length).toBeLessThanOrEqual(300);
  });

  it("handles missing Published field", () => {
    const text =
      "Title: No Date Article\nURL: https://example.com/article\nHighlights:\nSome content here.";
    const results = parseMcpResultBlocks(text);

    expect(results).toHaveLength(1);
    expect(results[0].published).toBeNull();
  });

  it("skips blocks without valid URL", () => {
    const text =
      "Title: Bad Block\nSome random text\n---\nTitle: Good Block\nURL: https://example.com\nHighlights:\nContent.";
    const results = parseMcpResultBlocks(text);

    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Good Block");
  });

  it("returns empty array for empty text", () => {
    expect(parseMcpResultBlocks("")).toEqual([]);
    expect(parseMcpResultBlocks("   ")).toEqual([]);
  });

  it("truncates snippets to 300 chars", () => {
    const longContent = "A".repeat(500);
    const text = `Title: Test\nURL: https://example.com\nHighlights:\n${longContent}`;
    const results = parseMcpResultBlocks(text);

    expect(results[0].snippet).toHaveLength(300);
  });
});

describe("extractJsonRpcPayload", () => {
  it("parses plain JSON when Content-Type is application/json", () => {
    const payload = extractJsonRpcPayload(JSON.stringify(mcpJsonFixture), "application/json");
    expect(payload.result?.content).toHaveLength(1);
  });

  it("parses SSE format scanning all data lines", () => {
    const payload = extractJsonRpcPayload(sseFixture, "text/event-stream");
    expect(payload.result?.content).toHaveLength(1);
  });

  it("falls back to parsing entire body as JSON", () => {
    const payload = extractJsonRpcPayload(JSON.stringify(mcpJsonFixture), "unknown/type");
    expect(payload.result?.content).toHaveLength(1);
  });

  it("throws on completely unparseable body", () => {
    expect(() => extractJsonRpcPayload("not json at all", "text/plain")).toThrow(
      "Exa MCP returned empty content",
    );
  });

  it("extracts error from JSON-RPC error response", () => {
    const payload = extractJsonRpcPayload(JSON.stringify(mcpErrorFixture), "application/json");
    expect(payload.error?.message).toBe("Rate limit exceeded. Please try again later.");
  });
});

describe("enrichQueryForMcp", () => {
  it("appends 'past hour' for hours freshness", () => {
    expect(enrichQueryForMcp("AAPL", "hours")).toBe("AAPL past hour");
  });

  it("appends 'past 24 hours' for day freshness", () => {
    expect(enrichQueryForMcp("AAPL earnings", "day")).toBe("AAPL earnings past 24 hours");
  });

  it("appends 'past week' for week freshness", () => {
    expect(enrichQueryForMcp("Fed rate", "week")).toBe("Fed rate past week");
  });

  it("appends 'past month' for month freshness", () => {
    expect(enrichQueryForMcp("bitcoin", "month")).toBe("bitcoin past month");
  });
});

describe("filterByFreshness", () => {
  const now = Date.now();

  const results: ParsedResult[] = [
    {
      title: "Fresh",
      url: "https://a.com",
      published: new Date(now - 1000).toISOString(),
      snippet: "fresh",
    },
    {
      title: "Old",
      url: "https://b.com",
      published: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
      snippet: "old",
    },
    { title: "No Date", url: "https://c.com", published: null, snippet: "no date" },
  ];

  it("keeps fresh results and drops old ones for day freshness", () => {
    const filtered = filterByFreshness(results, "day");
    expect(filtered.map((r) => r.title)).toEqual(["Fresh", "No Date"]);
  });

  it("keeps all results for month freshness", () => {
    const filtered = filterByFreshness(results, "month");
    expect(filtered).toHaveLength(3);
  });

  it("keeps results with no published date (benefit of the doubt)", () => {
    const noDates: ParsedResult[] = [
      { title: "X", url: "https://x.com", published: null, snippet: "" },
    ];
    expect(filterByFreshness(noDates, "hours")).toHaveLength(1);
  });
});

describe("mapApiResults", () => {
  it("maps API response to ParsedResult array", () => {
    const results = mapApiResults(apiResponseFixture.results);

    expect(results).toHaveLength(2);
    expect(results[0].title).toBe("Apple Set to Deliver Slight Earnings Miss for March Quarter");
    expect(results[0].url).toContain("proactiveinvestors.com");
    expect(results[0].published).toBe("2026-04-10T15:46:00.000Z");
    expect(results[0].snippet.length).toBeLessThanOrEqual(300);
  });

  it("uses highlights joined for snippet, falls back to text", () => {
    const results = mapApiResults([
      {
        url: "https://a.com",
        text: "fallback text",
        highlights: ["highlight one", "highlight two"],
      },
    ]);
    expect(results[0].snippet).toBe("highlight one highlight two");

    const results2 = mapApiResults([{ url: "https://b.com", text: "fallback text" }]);
    expect(results2[0].snippet).toBe("fallback text");
  });

  it("skips results without URL", () => {
    const results = mapApiResults([
      { title: "No URL" },
      { url: "https://a.com", title: "Has URL" },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Has URL");
  });
});

describe("exaSearch (MCP path)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-04-15T00:00:00Z").getTime());
    rateLimiter.configure("exa", 100, 100);
    mockedGetConfig.mockReturnValue({} as any); // no API key → MCP path
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls MCP endpoint and parses SSE response", async () => {
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-04-15T00:00:00Z").getTime());
    rateLimiter.configure("exa", 100, 100);
    try {
      globalThis.fetch = mockFetchResponse(sseFixture, { contentType: "text/event-stream" });

      const result = await exaSearch("AAPL stock news", {
        category: "news",
        freshness: "month",
        limit: 10,
      });

      expect(result.provider).toBe("exa");
      expect(result.resultCount).toBe(3);
      expect(result.results[0].source).toBe("proactiveinvestors.com");
      expect(result.results[0].category).toBe("news");
      // Verify fetch was called with MCP URL
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://mcp.exa.ai/mcp",
        expect.objectContaining({ method: "POST" }),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("parses plain JSON response (Content-Type: application/json)", async () => {
    globalThis.fetch = mockFetchResponse(JSON.stringify(mcpJsonFixture), {
      contentType: "application/json",
    });

    const result = await exaSearch("Fed rate", { category: "news", freshness: "month", limit: 5 });

    expect(result.provider).toBe("exa");
    expect(result.resultCount).toBe(1);
    expect(result.results[0].title).toContain("Fed Holds Rates");
  });

  it("throws on JSON-RPC error response", async () => {
    globalThis.fetch = mockFetchResponse(JSON.stringify(mcpErrorFixture), {
      contentType: "application/json",
    });

    await expect(
      exaSearch("test", { category: "news", freshness: "day", limit: 5 }),
    ).rejects.toThrow("Rate limit exceeded");
  });

  it("returns zero results for empty text (not an error)", async () => {
    globalThis.fetch = mockFetchResponse(JSON.stringify(mcpEmptyFixture), {
      contentType: "application/json",
    });

    const result = await exaSearch("xyznonexistent", {
      category: "general",
      freshness: "day",
      limit: 5,
    });

    expect(result.resultCount).toBe(0);
    expect(result.results).toEqual([]);
    expect(result.provider).toBe("exa");
  });

  it("throws on HTTP 429 with descriptive message", async () => {
    globalThis.fetch = mockFetchResponse("rate limited", {
      status: 429,
      contentType: "text/plain",
      headers: { "retry-after": "60" },
    });

    await expect(
      exaSearch("test", { category: "news", freshness: "day", limit: 5 }),
    ).rejects.toThrow(/429.*retry after 60/);
  });

  it("throws on HTTP 403", async () => {
    globalThis.fetch = mockFetchResponse("forbidden", { status: 403, contentType: "text/plain" });

    await expect(
      exaSearch("test", { category: "news", freshness: "day", limit: 5 }),
    ).rejects.toThrow(/403.*IP-based blocking/);
  });

  it("throws on HTML challenge page", async () => {
    globalThis.fetch = mockFetchResponse("<html><body>challenge</body></html>", {
      contentType: "text/html",
    });

    await expect(
      exaSearch("test", { category: "news", freshness: "day", limit: 5 }),
    ).rejects.toThrow(/HTML instead of JSON-RPC/);
  });

  it("uses unique request IDs", async () => {
    globalThis.fetch = mockFetchResponse(sseFixture, { contentType: "text/event-stream" });

    await exaSearch("query1", { category: "news", freshness: "month", limit: 5 });
    cache.clear();
    await exaSearch("query2", { category: "news", freshness: "month", limit: 5 });

    const calls = vi.mocked(globalThis.fetch).mock.calls;
    const body1 = JSON.parse(calls[0][1]?.body as string);
    const body2 = JSON.parse(calls[1][1]?.body as string);
    expect(body1.id).not.toBe(body2.id);
  });

  it("enriches query with freshness hint", async () => {
    globalThis.fetch = mockFetchResponse(sseFixture, { contentType: "text/event-stream" });

    await exaSearch("AAPL", { category: "news", freshness: "day", limit: 5 });

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body as string);
    expect(body.params.arguments.query).toBe("AAPL past 24 hours");
  });

  it("post-filters results by freshness", async () => {
    globalThis.fetch = mockFetchResponse(sseFixture, { contentType: "text/event-stream" });

    // With "hours" freshness, the fixture articles (days old) should be filtered out
    const result = await exaSearch("AAPL", { category: "news", freshness: "hours", limit: 10 });

    // All fixture results are older than 1 hour, so should be filtered
    expect(result.resultCount).toBe(0);
  });

  it("returns cached results within TTL", async () => {
    globalThis.fetch = mockFetchResponse(sseFixture, { contentType: "text/event-stream" });

    await exaSearch("AAPL", { category: "news", freshness: "month", limit: 5 });
    await exaSearch("AAPL", { category: "news", freshness: "month", limit: 5 });

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to stale cache on error", async () => {
    globalThis.fetch = mockFetchResponse(sseFixture, { contentType: "text/event-stream" });
    await exaSearch("AAPL", { category: "news", freshness: "month", limit: 5 });

    // Expire cache, set as stale
    cache.clear();
    (cache as any).store.set("web:exa:AAPL:news:month:5", {
      value: {
        query: "AAPL",
        results: [],
        resultCount: 0,
        fetchedAt: "2026-04-11T00:00:00Z",
        provider: "exa",
      },
      expiresAt: Date.now() - 1000,
      cachedAt: Date.now() - 60_000,
    });

    globalThis.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    const result = await exaSearch("AAPL", { category: "news", freshness: "month", limit: 5 });
    expect(result.resultCount).toBe(0); // stale data
  });
});

describe("exaSearch (API path)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
    vi.clearAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(new Date("2026-04-15T00:00:00Z").getTime());
    rateLimiter.configure("exa", 100, 100);
    mockedGetConfig.mockReturnValue({ exaApiKey: "test-exa-key" } as any);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("calls direct API when EXA_API_KEY is set", async () => {
    const nowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-04-15T00:00:00Z").getTime());
    rateLimiter.configure("exa", 100, 100);
    try {
      globalThis.fetch = mockFetchResponse(JSON.stringify(apiResponseFixture), {
        contentType: "application/json",
      });

      const result = await exaSearch("AAPL", { category: "news", freshness: "month", limit: 5 });

      expect(result.provider).toBe("exa");
      expect(result.resultCount).toBe(2);
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://api.exa.ai/search",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({ "x-api-key": "test-exa-key" }),
        }),
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("sends startPublishedDate computed from Date.now()", async () => {
    globalThis.fetch = mockFetchResponse(JSON.stringify(apiResponseFixture), {
      contentType: "application/json",
    });

    await exaSearch("AAPL", { category: "news", freshness: "week", limit: 5 });

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body as string);
    expect(body.startPublishedDate).toBeDefined();
    // Should be roughly 7 days ago
    const pubDate = new Date(body.startPublishedDate).getTime();
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(pubDate - sevenDaysAgo)).toBeLessThan(5000); // within 5s
  });

  it("does not enrich query with freshness text (uses startPublishedDate instead)", async () => {
    globalThis.fetch = mockFetchResponse(JSON.stringify(apiResponseFixture), {
      contentType: "application/json",
    });

    await exaSearch("AAPL", { category: "news", freshness: "day", limit: 5 });

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body as string);
    expect(body.query).toBe("AAPL"); // not "AAPL past 24 hours"
  });

  it("throws ProviderCredentialError with reason=stale on 401", async () => {
    const { ProviderCredentialError } = await import(
      "../../../src/providers/provider-credential-error.js"
    );
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      headers: new Headers({ "content-type": "application/json" }),
      text: () => Promise.resolve('{"error":"Invalid API key"}'),
    });

    try {
      await exaSearch("test", { category: "news", freshness: "day", limit: 5 });
      throw new Error("expected ProviderCredentialError");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderCredentialError);
      const credErr = err as InstanceType<typeof ProviderCredentialError>;
      expect(credErr.provider).toBe("exa");
      expect(credErr.reason).toBe("stale");
      expect(credErr.httpStatus).toBe(401);
    }
  });

  it("throws ProviderCredentialError on 403", async () => {
    const { ProviderCredentialError } = await import(
      "../../../src/providers/provider-credential-error.js"
    );
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: new Headers({ "content-type": "application/json" }),
      text: () => Promise.resolve("Forbidden"),
    });

    await expect(
      exaSearch("test", { category: "news", freshness: "day", limit: 5 }),
    ).rejects.toBeInstanceOf(ProviderCredentialError);
  });

  it("throws generic Error on non-auth API errors (e.g. 500)", async () => {
    const { ProviderCredentialError } = await import(
      "../../../src/providers/provider-credential-error.js"
    );
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      headers: new Headers({ "content-type": "application/json" }),
      text: () => Promise.resolve('{"error":"server error"}'),
    });

    try {
      await exaSearch("test", { category: "news", freshness: "day", limit: 5 });
      throw new Error("expected some error");
    } catch (err) {
      // Must NOT be classified as credential
      expect(err).not.toBeInstanceOf(ProviderCredentialError);
      expect((err as Error).message).toContain("Exa API HTTP 500");
    }
  });
});
