import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import {
  getPostComments,
  getSubredditPosts,
  scoreSentiment,
} from "../../../src/providers/reddit.js";
import commentsFixture from "../../fixtures/reddit/comments.json";
import listingFixture from "../../fixtures/reddit/listing-with-ids.json";
import fixture from "../../fixtures/yahoo/reddit-wallstreetbets.json";

describe("reddit provider", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns posts from subreddit", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    const result = await getSubredditPosts("wallstreetbets", 25);
    expect(result.subreddit).toBe("wallstreetbets");
    expect(result.postCount).toBe(3);
    expect(result.posts[0].title).toContain("$AAPL");
    expect(result.posts[0].score).toBe(1523);
  });

  it("extracts ticker mentions from post titles", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    const result = await getSubredditPosts("wallstreetbets");
    expect(result.topMentions).toContain("AAPL");
    expect(result.topMentions).toContain("TSLA");
    expect(result.topMentions).toContain("NVDA");
  });

  it("caches results", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    await getSubredditPosts("wallstreetbets", 25);
    await getSubredditPosts("wallstreetbets", 25);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("includes sentiment score in results", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(fixture),
    });

    const result = await getSubredditPosts("wallstreetbets", 25);
    expect(result).toHaveProperty("sentimentScore");
    expect(result).toHaveProperty("bullishCount");
    expect(result).toHaveProperty("bearishCount");
    expect(typeof result.sentimentScore).toBe("number");
    // Fixture has "bullish" in post 2, no bearish terms → positive score
    expect(result.sentimentScore).toBeGreaterThan(0);
    expect(result.bullishCount).toBeGreaterThanOrEqual(1);
  });

  it("returns id, author, and selftext per post", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(listingFixture),
    });

    const result = await getSubredditPosts("stocks", 25);
    expect(result.posts[0]).toHaveProperty("id");
    expect(result.posts[0].id).toBe("abc123");
    expect(result.posts[0]).toHaveProperty("author");
    expect(result.posts[0].author).toBe("stock_guru");
    expect(result.posts[0]).toHaveProperty("selftext");
    expect(result.posts[0].selftext).toContain("Apple just reported");
  });
});

describe("getPostComments", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("extracts top N comments by score", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(commentsFixture),
    });

    const comments = await getPostComments("stocks", "abc123", 5);
    expect(comments).toHaveLength(5);
    expect(comments[0].author).toBe("bull_trader");
    expect(comments[0].score).toBe(312);
    expect(comments[0].body).toContain("bullish");
  });

  it("caches comments with 30-min TTL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(commentsFixture),
    });

    await getPostComments("stocks", "abc123", 5);
    await getPostComments("stocks", "abc123", 5);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("scoreSentiment", () => {
  it("returns positive score for bullish posts", () => {
    const posts = [
      { title: "Time to buy the dip! Moon incoming!" },
      { title: "So bullish on this breakout" },
    ];
    const result = scoreSentiment(posts);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.bullish).toBeGreaterThan(0);
  });

  it("returns negative score for bearish posts", () => {
    const posts = [
      { title: "This stock is going to crash hard" },
      { title: "Time to sell, bubble is about to dump" },
    ];
    const result = scoreSentiment(posts);
    expect(result.score).toBeLessThan(0);
    expect(result.score).toBeGreaterThanOrEqual(-1);
    expect(result.bearish).toBeGreaterThan(0);
  });

  it("returns 0 for neutral posts with no sentiment words", () => {
    const posts = [
      { title: "Fed decision tomorrow - what are your plays?" },
      { title: "Earnings report coming next week" },
    ];
    const result = scoreSentiment(posts);
    expect(result.score).toBe(0);
    expect(result.bullish).toBe(0);
    expect(result.bearish).toBe(0);
  });

  it("returns balanced score for mixed sentiment", () => {
    const posts = [{ title: "I'm bullish but this could crash" }];
    const result = scoreSentiment(posts);
    // 1 bullish + 1 bearish = score of 0
    expect(result.score).toBe(0);
    expect(result.bullish).toBe(1);
    expect(result.bearish).toBe(1);
  });
});
