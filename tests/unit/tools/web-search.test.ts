import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import type { WebSearchEnvelope } from "../../../src/types/sentiment.js";
import type { ProviderResult } from "../../../src/runtime/evidence.js";

// Mock the provider
vi.mock("../../../src/providers/web-search.js", () => ({
  searchWeb: vi.fn(),
}));

import { searchWeb } from "../../../src/providers/web-search.js";
import { webSearchTool } from "../../../src/tools/sentiment/web-search.js";

const mockedSearchWeb = vi.mocked(searchWeb);

const successEnvelope: WebSearchEnvelope = {
  query: "AAPL stock news",
  results: [
    {
      title: "Apple Earnings Beat [Estimates]",
      url: "https://reuters.com/apple-earnings",
      snippet: "Apple reported $124.3B revenue | beating estimates.",
      source: "reuters.com",
      published: "2026-04-10T14:30:00Z",
      category: "news",
    },
    {
      title: "AAPL Stock Surges",
      url: "https://cnbc.com/aapl",
      snippet: "AAPL up 5% in after-hours trading.",
      source: "cnbc.com",
      published: "2026-04-10T16:00:00Z",
      category: "news",
    },
  ],
  resultCount: 2,
  fetchedAt: "2026-04-11T08:00:00Z",
  provider: "ddg",
};

function okResult(data: WebSearchEnvelope): ProviderResult<WebSearchEnvelope> {
  return { status: "ok", data, timestamp: data.fetchedAt, provider: "ddg" };
}

function unavailableResult(): ProviderResult<WebSearchEnvelope> {
  return { status: "unavailable", reason: "all providers failed: ddg", provider: "ddg" };
}

function staleResult(data: WebSearchEnvelope): ProviderResult<WebSearchEnvelope> {
  return { status: "ok", data, timestamp: data.fetchedAt, provider: "ddg", stale: true };
}

describe("search_web tool", () => {
  beforeEach(() => {
    cache.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct tool metadata", () => {
    expect(webSearchTool.name).toBe("search_web");
    expect(webSearchTool.label).toBeTruthy();
    expect(webSearchTool.description).toBeTruthy();
  });

  it("applies default params: category news, freshness day, limit 10", async () => {
    mockedSearchWeb.mockResolvedValue(okResult(successEnvelope));

    await webSearchTool.execute("call-1", { query: "AAPL earnings" });

    expect(mockedSearchWeb).toHaveBeenCalledWith("AAPL earnings", {
      category: "news",
      freshness: "day",
      limit: 10,
    });
  });

  it("passes through category and freshness overrides", async () => {
    mockedSearchWeb.mockResolvedValue(okResult(successEnvelope));

    await webSearchTool.execute("call-1", {
      query: "what is a SPAC",
      category: "general",
      freshness: "month",
      limit: 5,
    });

    expect(mockedSearchWeb).toHaveBeenCalledWith("what is a SPAC", {
      category: "general",
      freshness: "month",
      limit: 5,
    });
  });

  it("clamps limit to 1..20", async () => {
    mockedSearchWeb.mockResolvedValue(okResult(successEnvelope));

    await webSearchTool.execute("call-1", { query: "test", limit: 50 });

    expect(mockedSearchWeb).toHaveBeenCalledWith("test", expect.objectContaining({ limit: 20 }));

    mockedSearchWeb.mockClear();
    await webSearchTool.execute("call-2", { query: "test", limit: 0 });
    expect(mockedSearchWeb).toHaveBeenCalledWith("test", expect.objectContaining({ limit: 1 }));
  });

  it("rejects empty queries without calling provider", async () => {
    const result = await webSearchTool.execute("call-1", { query: "" });

    expect(result.content[0].text).toMatch(/empty|query/i);
    expect(result.details).toBeNull();
    expect(mockedSearchWeb).not.toHaveBeenCalled();
  });

  it("rejects whitespace-only queries", async () => {
    const result = await webSearchTool.execute("call-1", { query: "   " });

    expect(result.content[0].text).toMatch(/empty|query/i);
    expect(result.details).toBeNull();
    expect(mockedSearchWeb).not.toHaveBeenCalled();
  });

  it("returns formatted markdown on success", async () => {
    mockedSearchWeb.mockResolvedValue(okResult(successEnvelope));

    const result = await webSearchTool.execute("call-1", { query: "AAPL" });

    const text = result.content[0].text;
    expect(text).toContain("2 results");
    expect(text).toContain("reuters.com");
    expect(text).toContain("cnbc.com");
    expect(text).toContain("ddg");
  });

  it("escapes markdown-sensitive characters in titles", async () => {
    mockedSearchWeb.mockResolvedValue(okResult(successEnvelope));

    const result = await webSearchTool.execute("call-1", { query: "AAPL" });

    const text = result.content[0].text;
    // Title has [Estimates] which contains brackets — should be escaped
    expect(text).toContain("\\[Estimates\\]");
  });

  it("returns details as WebSearchEnvelope", async () => {
    mockedSearchWeb.mockResolvedValue(okResult(successEnvelope));

    const result = await webSearchTool.execute("call-1", { query: "AAPL" });

    expect(result.details).toBeDefined();
    expect(result.details.query).toBe("AAPL stock news");
    expect(result.details.resultCount).toBe(2);
    expect(result.details.provider).toBe("ddg");
  });

  it("handles unavailable status with null details", async () => {
    mockedSearchWeb.mockResolvedValue(unavailableResult());

    const result = await webSearchTool.execute("call-1", { query: "test" });

    expect(result.content[0].text).toContain("⚠");
    expect(result.content[0].text).toMatch(/unavailable/i);
    expect(result.details).toBeNull();
  });

  it("shows stale cache warning", async () => {
    mockedSearchWeb.mockResolvedValue(staleResult(successEnvelope));

    const result = await webSearchTool.execute("call-1", { query: "AAPL" });

    expect(result.content[0].text).toContain("⚠");
    expect(result.content[0].text).toMatch(/cached/i);
  });

  it("handles zero results gracefully", async () => {
    const emptyEnvelope: WebSearchEnvelope = {
      query: "xyznonexistent",
      results: [],
      resultCount: 0,
      fetchedAt: "2026-04-11T08:00:00Z",
      provider: "ddg",
    };
    mockedSearchWeb.mockResolvedValue(okResult(emptyEnvelope));

    const result = await webSearchTool.execute("call-1", { query: "xyznonexistent" });

    expect(result.content[0].text).toMatch(/[Nn]o results/);
    expect(result.details.resultCount).toBe(0);
  });
});
