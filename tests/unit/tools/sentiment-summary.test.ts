import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import type { RedditSentimentResult, WebSearchEnvelope } from "../../../src/types/sentiment.js";
import type { ProviderResult } from "../../../src/runtime/evidence.js";
import listingFixture from "../../fixtures/reddit/listing-with-ids.json";

const originalFetch = globalThis.fetch;

// Mock the web-search provider
vi.mock("../../../src/providers/web-search.js", () => ({
  searchWeb: vi.fn(),
}));

// Mock the twitter provider to avoid scraper initialization
vi.mock("../../../src/providers/twitter.js", () => ({
  getTwitterSentiment: vi.fn(),
}));

// Mock wrap-provider to avoid stale-cache retry delays
vi.mock("../../../src/providers/wrap-provider.js", () => ({
  wrapProvider: vi.fn(),
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
import { getTwitterSentiment } from "../../../src/providers/twitter.js";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import { sentimentSummaryTool } from "../../../src/tools/sentiment/sentiment-summary.js";

const mockedGetTwitterSentiment = vi.mocked(getTwitterSentiment);
const mockedWrapProvider = vi.mocked(wrapProvider);

const mockedSearchWeb = vi.mocked(searchWeb);

beforeEach(() => { cache.clear(); });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("get_sentiment_summary tool", () => {
  it("has correct tool name", () => {
    expect(sentimentSummaryTool.name).toBe("get_sentiment_summary");
  });

  it("returns per-source breakdown when reddit and web available", async () => {
    // Mock twitter wrapProvider as unavailable
    mockedWrapProvider.mockImplementation(async (provider, fn) => {
      if (provider === "twitter") {
        return { status: "unavailable", reason: "No Twitter session found" } as any;
      }
      // Reddit — return fixture data
      return {
        status: "ok",
        data: {
          subreddit: "stocks",
          postCount: 3,
          posts: listingFixture.data.children.map((c: any) => ({
            id: c.data.id,
            title: c.data.title,
            selftext: c.data.selftext,
            author: c.data.author,
            score: c.data.score,
            comments: c.data.num_comments,
            url: `https://reddit.com${c.data.permalink}`,
            created: new Date(c.data.created_utc * 1000).toISOString(),
          })),
          topMentions: ["AAPL"],
          sentimentScore: 0.3,
          bullishCount: 1,
          bearishCount: 0,
          fetchedAt: new Date().toISOString(),
        },
      };
    });

    // Mock web search
    const webEnvelope: WebSearchEnvelope = {
      query: "AAPL news",
      results: [{
        title: "AAPL bullish breakout",
        url: "https://reuters.com/aapl",
        snippet: "Apple stock bullish after earnings beat.",
        source: "reuters.com",
        published: "2026-04-11T10:00:00Z",
        category: "news",
      }],
      resultCount: 1,
      fetchedAt: "2026-04-11T12:00:00Z",
      provider: "ddg",
    };
    const webResult: ProviderResult<WebSearchEnvelope> = { status: "ok", data: webEnvelope };
    mockedSearchWeb.mockResolvedValue(webResult);

    const result = await sentimentSummaryTool.execute("call-1", { query: "AAPL" });
    const text = result.content[0].text;

    expect(text).toContain("Sentiment summary");
    expect(text).toContain("AAPL");
    expect(text).toContain("Aggregate");
    expect(text).toContain("Source");
    expect(text).toContain("Score");
  });

  it("handles all sources unavailable", async () => {
    // All providers unavailable via wrapProvider mock
    mockedWrapProvider.mockResolvedValue({ status: "unavailable", reason: "service down" } as any);
    mockedSearchWeb.mockResolvedValue({ status: "unavailable", reason: "failed" } as any);

    const result = await sentimentSummaryTool.execute("call-2", { query: "XYZ" });
    expect(result.content[0].text).toContain("unavailable");
  });
});
