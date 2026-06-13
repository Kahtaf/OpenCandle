import { describe, expect, it } from "vitest";
import type { RedditComment } from "../../../../src/providers/reddit.js";
import { RedditAdapter } from "../../../../src/sentiment/adapters/reddit.js";
import type { RedditSentimentResult } from "../../../../src/types/sentiment.js";

const mockResult: RedditSentimentResult = {
  subreddit: "stocks",
  postCount: 2,
  posts: [
    {
      id: "post-001",
      title: "$AAPL earnings beat expectations",
      selftext: "Apple reported massive numbers",
      author: "stock_guru",
      score: 542,
      comments: 89,
      url: "https://reddit.com/r/stocks/comments/post-001/",
      created: "2026-04-11T12:00:00Z",
    },
    {
      id: "post-002",
      title: "Weekly discussion",
      selftext: "",
      author: "AutoModerator",
      score: 10,
      comments: 0,
      url: "https://reddit.com/r/stocks/comments/post-002/",
      created: "2026-04-11T11:00:00Z",
    },
  ],
  topMentions: ["AAPL"],
  sentimentScore: 0.3,
  bullishCount: 1,
  bearishCount: 0,
  fetchedAt: "2026-04-11T12:01:00Z",
};

const mockComments: RedditComment[] = [
  {
    id: "c1",
    body: "Very bullish on AAPL",
    author: "bull_guy",
    score: 100,
    permalink: "https://reddit.com/r/stocks/comments/post-001/c1/",
  },
  {
    id: "c2",
    body: "Sell the news",
    author: "bear_guy",
    score: 50,
    permalink: "https://reddit.com/r/stocks/comments/post-001/c2/",
  },
];

describe("RedditAdapter", () => {
  const adapter = new RedditAdapter();

  it("has source reddit", () => {
    expect(adapter.source).toBe("reddit");
  });

  it("maps posts to SentinelRecords", () => {
    const records = adapter.mapPostsToRecords(mockResult, "AAPL");
    expect(records.length).toBe(2);

    const rec = records[0];
    expect(rec.source).toBe("reddit");
    expect(rec.sourceId).toBe("post-001");
    expect(rec.query).toBe("AAPL");
    expect(rec.title).toBe("$AAPL earnings beat expectations");
    expect(rec.text).toContain("Apple reported massive numbers");
    expect(rec.author).toBe("stock_guru");
    expect(rec.engagement.score).toBe(542);
    expect(rec.engagement.replies).toBe(89);
  });

  it("maps comments to SentinelRecords with isComment metadata", () => {
    const records = adapter.mapCommentsToRecords(mockComments, "post-001", "stocks", "AAPL");
    expect(records.length).toBe(2);

    const rec = records[0];
    expect(rec.source).toBe("reddit");
    expect(rec.sourceId).toBe("c1");
    expect(rec.text).toBe("Very bullish on AAPL");
    expect(rec.metadata.isComment).toBe(true);
    expect(rec.metadata.parentId).toBe("post-001");
  });

  it("post with 0 comments produces no comment records", () => {
    const records = adapter.mapCommentsToRecords([], "post-002", "stocks", "AAPL");
    expect(records.length).toBe(0);
  });
});
