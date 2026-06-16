import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import { ExternalToolError } from "../../../src/providers/external-tool-error.js";
import {
  getTwitterSentiment,
  normalizeQuery,
  scoreTwitterSentiment,
} from "../../../src/providers/twitter.js";
import type { TwitterTweet } from "../../../src/types/sentiment.js";

const mocks = vi.hoisted(() => ({
  searchTweets: vi.fn(),
}));

vi.mock("../../../src/providers/twitter-cli.js", () => ({
  searchTweets: mocks.searchTweets,
}));

function freshTweets(): TwitterTweet[] {
  const created = new Date(Date.now() - 60_000).toISOString();
  return [
    {
      id: "1234567890",
      text: "$AAPL moon incoming! So bullish on this breakout",
      author: "trader_joe",
      likes: 150,
      retweets: 45,
      replies: 12,
      views: 5000,
      url: "https://x.com/trader_joe/status/1234567890",
      created,
    },
    {
      id: "1234567891",
      text: "$AAPL overvalued, this bubble is about to crash. Puts loaded.",
      author: "bear_market_bob",
      likes: 500,
      retweets: 120,
      replies: 88,
      views: 15000,
      url: "https://x.com/bear_market_bob/status/1234567891",
      created,
    },
    {
      id: "1234567892",
      text: "Watching $AAPL and $TSLA today.",
      author: "market_watcher",
      likes: 30,
      retweets: 5,
      replies: 3,
      views: 800,
      url: "https://x.com/market_watcher/status/1234567892",
      created,
    },
  ];
}

describe("normalizeQuery", () => {
  it("prepends $ to bare tickers", () => {
    expect(normalizeQuery("AAPL")).toBe("$AAPL");
    expect(normalizeQuery("TSLA")).toBe("$TSLA");
    expect(normalizeQuery("A")).toBe("$A");
  });

  it("passes non-bare-ticker queries through unchanged", () => {
    expect(normalizeQuery("$TSLA")).toBe("$TSLA");
    expect(normalizeQuery("AAPL earnings call")).toBe("AAPL earnings call");
    expect(normalizeQuery("aapl")).toBe("aapl");
    expect(normalizeQuery("ABCDEF")).toBe("ABCDEF");
  });
});

describe("scoreTwitterSentiment", () => {
  it("returns positive score weighted by engagement for bullish tweets", () => {
    const result = scoreTwitterSentiment([
      { text: "So bullish on this breakout! Moon!", likes: 100, retweets: 50 },
    ]);
    expect(result.score).toBeGreaterThan(0);
    expect(result.bullish).toBeGreaterThan(0);
    expect(result.bearish).toBe(0);
  });

  it("engagement weighting skews toward high-engagement tweets", () => {
    const result = scoreTwitterSentiment([
      { text: "bullish", likes: 1, retweets: 0 },
      { text: "bearish crash", likes: 500, retweets: 200 },
    ]);
    expect(result.score).toBeLessThan(0);
  });

  it("returns 0 for neutral or empty tweets", () => {
    expect(
      scoreTwitterSentiment([{ text: "Fed decision tomorrow", likes: 10, retweets: 2 }]),
    ).toEqual({ score: 0, bullish: 0, bearish: 0 });
    expect(scoreTwitterSentiment([])).toEqual({ score: 0, bullish: 0, bearish: 0 });
  });
});

describe("getTwitterSentiment", () => {
  beforeEach(() => {
    cache.clear();
    mocks.searchTweets.mockReset();
  });

  afterEach(() => {
    cache.clear();
  });

  it("uses twitter-cli search results and preserves the sentiment contract", async () => {
    const tweets = freshTweets();
    mocks.searchTweets.mockResolvedValue(tweets);

    const result = await getTwitterSentiment("AAPL", 50, 24);

    expect(mocks.searchTweets).toHaveBeenCalledWith("$AAPL", 50);
    expect(result.query).toBe("$AAPL");
    expect(result.tweetCount).toBe(3);
    expect(result.tweets[0]).toHaveProperty("id", "1234567890");
    expect(result.topMentions).toEqual(["TSLA"]);
    expect(result.sentimentScore).toBeLessThan(0);
  });

  it("returns cached result on second call", async () => {
    const tweets = freshTweets();
    mocks.searchTweets.mockResolvedValue(tweets);

    const result1 = await getTwitterSentiment("AAPL", 50, 24);
    const result2 = await getTwitterSentiment("AAPL", 50, 24);

    expect(result2).toEqual(result1);
    expect(mocks.searchTweets).toHaveBeenCalledTimes(1);
  });

  it("filters tweets outside the requested lookback", async () => {
    const tweets = freshTweets();
    mocks.searchTweets.mockResolvedValue([
      ...tweets,
      { ...tweets[0], id: "old", created: new Date(Date.now() - 72 * 3_600_000).toISOString() },
    ]);

    const result = await getTwitterSentiment("AAPL", 50, 24);

    expect(result.tweets.map((tweet) => tweet.id)).not.toContain("old");
  });

  it("surfaces twitter-cli failures when no stale cache is available", async () => {
    mocks.searchTweets.mockRejectedValue(new ExternalToolError("twitter-cli", "401 unauthorized"));

    await expect(getTwitterSentiment("TSLA")).rejects.toThrow("401 unauthorized");
  });
});
