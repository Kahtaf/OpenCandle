import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { twitterSentimentTool } from "../../../src/tools/sentiment/twitter-sentiment.js";
import { cache } from "../../../src/infra/cache.js";
import type { TwitterSentimentResult } from "../../../src/types/sentiment.js";

// Mock the provider
vi.mock("../../../src/providers/twitter.js", () => ({
  getTwitterSentiment: vi.fn(),
}));

// Mock wrap-provider to pass through or return unavailable
vi.mock("../../../src/providers/wrap-provider.js", () => ({
  wrapProvider: vi.fn(),
}));

describe("get_twitter_sentiment tool", () => {
  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("has correct tool metadata", () => {
    expect(twitterSentimentTool.name).toBe("get_twitter_sentiment");
    expect(twitterSentimentTool.label).toBe("Twitter Sentiment");
    expect(twitterSentimentTool.description).toBeTruthy();
  });

  it("returns formatted markdown with tweet table on success", async () => {
    const { wrapProvider } = await import("../../../src/providers/wrap-provider.js");
    const mockResult: TwitterSentimentResult = {
      query: "$AAPL",
      tweetCount: 2,
      tweets: [
        {
          text: "AAPL to the moon!",
          author: "trader_joe",
          likes: 100,
          retweets: 30,
          replies: 5,
          views: 2000,
          url: "https://x.com/trader_joe/status/123",
          created: "2026-04-04T10:00:00.000Z",
        },
        {
          text: "Bearish on AAPL",
          author: "bear_bob",
          likes: 50,
          retweets: 10,
          replies: 3,
          views: 800,
          url: "https://x.com/bear_bob/status/124",
          created: "2026-04-04T09:00:00.000Z",
        },
      ],
      sentimentScore: 0.5,
      bullishCount: 2,
      bearishCount: 1,
      topMentions: ["TSLA", "NVDA"],
      fetchedAt: "2026-04-04T12:00:00.000Z",
    };

    vi.mocked(wrapProvider).mockResolvedValue({
      status: "ok",
      data: mockResult,
      timestamp: new Date().toISOString(),
    });

    const result = await twitterSentimentTool.execute("call-1", { query: "AAPL" });
    const text = (result.content[0] as any).text;

    expect(text).toContain("Twitter: $AAPL");
    expect(text).toContain("2 tweets");
    expect(text).toContain("0.50");
    expect(text).toContain("Bullish");
    expect(text).toContain("$TSLA");
    expect(text).toContain("$NVDA");
    expect(text).toContain("@trader_joe");
    expect(text).toContain("| Author |");
  });

  it("returns LOGIN_NEEDED directive when login is required", async () => {
    const { wrapProvider } = await import("../../../src/providers/wrap-provider.js");
    vi.mocked(wrapProvider).mockResolvedValue({
      status: "unavailable",
      reason: "No Twitter session found.",
      provider: "twitter",
    });

    const result = await twitterSentimentTool.execute("call-2", { query: "AAPL" });
    const text = (result.content[0] as any).text;

    expect(text).toContain("⚠ Twitter sentiment unavailable");
    expect(text).toContain("[LOGIN_NEEDED]");
    expect(result.details).toBeNull();
  });

  it("returns generic unavailable for non-login errors", async () => {
    const { wrapProvider } = await import("../../../src/providers/wrap-provider.js");
    vi.mocked(wrapProvider).mockResolvedValue({
      status: "unavailable",
      reason: "provider_circuit_open",
      provider: "twitter",
    });

    const result = await twitterSentimentTool.execute("call-2b", { query: "AAPL" });
    const text = (result.content[0] as any).text;

    expect(text).toContain("⚠ Twitter sentiment unavailable");
    expect(text).not.toContain("[LOGIN_NEEDED]");
    expect(result.details).toBeNull();
  });

  it("clamps limit to 200", async () => {
    const { wrapProvider } = await import("../../../src/providers/wrap-provider.js");
    const { getTwitterSentiment } = await import("../../../src/providers/twitter.js");

    const mockResult: TwitterSentimentResult = {
      query: "$TEST",
      tweetCount: 0,
      tweets: [],
      sentimentScore: 0,
      bullishCount: 0,
      bearishCount: 0,
      topMentions: [],
      fetchedAt: new Date().toISOString(),
    };

    vi.mocked(getTwitterSentiment).mockResolvedValue(mockResult);
    vi.mocked(wrapProvider).mockImplementation(async (_id, fn) => {
      const data = await fn();
      return { status: "ok", data, timestamp: new Date().toISOString() };
    });

    await twitterSentimentTool.execute("call-3", { query: "TEST", limit: 500 });

    expect(getTwitterSentiment).toHaveBeenCalledWith("TEST", 200, 24);
  });

  it("shows stale data warning when result is stale", async () => {
    const { wrapProvider } = await import("../../../src/providers/wrap-provider.js");
    vi.mocked(wrapProvider).mockResolvedValue({
      status: "ok",
      data: {
        query: "$AAPL",
        tweetCount: 0,
        tweets: [],
        sentimentScore: 0,
        bullishCount: 0,
        bearishCount: 0,
        topMentions: [],
        fetchedAt: new Date().toISOString(),
      },
      timestamp: "2026-04-04T10:00:00.000Z",
      stale: true,
    });

    const result = await twitterSentimentTool.execute("call-4", { query: "AAPL" });
    const text = (result.content[0] as any).text;
    expect(text).toContain("⚠ Stale data");
  });
});
