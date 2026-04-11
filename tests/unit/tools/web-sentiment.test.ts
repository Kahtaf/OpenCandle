import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import type { WebSearchEnvelope } from "../../../src/types/sentiment.js";
import type { ProviderResult } from "../../../src/runtime/evidence.js";

// Mock the web-search provider
vi.mock("../../../src/providers/web-search.js", () => ({
  searchWeb: vi.fn(),
}));

// Mock the sentiment singleton to use :memory:
vi.mock("../../../src/sentiment/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/sentiment/index.js")>();
  const { SentimentStore } = await import("../../../src/sentiment/store.js");
  const { SentimentPipeline } = await import("../../../src/sentiment/pipeline.js");
  const memStore = new SentimentStore(":memory:");
  const pipeline = new SentimentPipeline(memStore, {
    retentionDays: 30,
    defaultSubreddits: ["stocks"],
    commentsPerPost: 5,
    divergenceThreshold: 0.4,
  });
  return {
    ...actual,
    getSentimentPipeline: () => pipeline,
    getSentimentStore: () => memStore,
  };
});

import { searchWeb } from "../../../src/providers/web-search.js";
import { webSentimentTool } from "../../../src/tools/sentiment/web-sentiment.js";

const mockedSearchWeb = vi.mocked(searchWeb);

const successEnvelope: WebSearchEnvelope = {
  query: "AAPL stock news",
  results: [
    {
      title: "Apple Earnings Beat",
      url: "https://reuters.com/apple-earnings",
      snippet: "Apple reported bullish earnings, revenue beat expectations.",
      source: "reuters.com",
      published: "2026-04-10T14:30:00Z",
      category: "news",
    },
  ],
  resultCount: 1,
  fetchedAt: "2026-04-11T08:00:00Z",
  provider: "ddg",
};

beforeEach(() => { cache.clear(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("get_web_sentiment tool", () => {
  it("has correct tool name", () => {
    expect(webSentimentTool.name).toBe("get_web_sentiment");
  });

  it("returns scored results", async () => {
    const providerResult: ProviderResult<WebSearchEnvelope> = {
      status: "ok",
      data: successEnvelope,
    };
    mockedSearchWeb.mockResolvedValue(providerResult);

    const result = await webSentimentTool.execute("call-1", { query: "AAPL" });
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Web sentiment");
  });

  it("handles unavailable provider", async () => {
    const providerResult: ProviderResult<WebSearchEnvelope> = {
      status: "unavailable",
      reason: "rate limited",
    };
    mockedSearchWeb.mockResolvedValue(providerResult as any);

    const result = await webSentimentTool.execute("call-2", { query: "AAPL" });
    expect(result.content[0].text).toContain("unavailable");
  });
});
