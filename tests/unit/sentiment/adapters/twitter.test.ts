import { describe, expect, it } from "vitest";
import { TwitterAdapter } from "../../../../src/sentiment/adapters/twitter.js";
import type { TwitterSentimentResult } from "../../../../src/types/sentiment.js";

const mockResult: TwitterSentimentResult = {
  query: "$AAPL",
  tweetCount: 2,
  tweets: [
    {
      id: "tweet-001",
      text: "$AAPL bullish breakout incoming",
      author: "@trader",
      likes: 100,
      retweets: 25,
      replies: 5,
      views: 2000,
      url: "https://x.com/trader/status/tweet-001",
      created: "2026-04-11T12:00:00Z",
    },
    {
      id: "tweet-002",
      text: "Watching $AAPL earnings tonight",
      author: "@watcher",
      likes: 10,
      retweets: 2,
      replies: 1,
      views: 500,
      url: "https://x.com/watcher/status/tweet-002",
      created: "2026-04-11T11:00:00Z",
    },
  ],
  sentimentScore: 0.5,
  bullishCount: 3,
  bearishCount: 0,
  topMentions: ["AAPL"],
  fetchedAt: "2026-04-11T12:01:00Z",
};

describe("TwitterAdapter", () => {
  const adapter = new TwitterAdapter();

  it("has source twitter", () => {
    expect(adapter.source).toBe("twitter");
  });

  it("maps TwitterTweet to SentinelRecord", () => {
    const records = adapter.mapToRecords(mockResult, "AAPL");
    expect(records).toHaveLength(2);

    const rec = records[0];
    expect(rec.source).toBe("twitter");
    expect(rec.sourceId).toBe("tweet-001");
    expect(rec.query).toBe("AAPL");
    expect(rec.title).toBeNull();
    expect(rec.text).toBe("$AAPL bullish breakout incoming");
    expect(rec.author).toBe("@trader");
    expect(rec.url).toBe("https://x.com/trader/status/tweet-001");
    expect(rec.publishedAt).toBe("2026-04-11T12:00:00Z");
    expect(rec.engagement.score).toBe(100);
    expect(rec.engagement.replies).toBe(5);
    expect(rec.engagement.shares).toBe(25);
    expect(rec.engagement.views).toBe(2000);
  });
});
