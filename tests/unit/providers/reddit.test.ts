import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import {
  getPostComments,
  getSubredditPosts,
  scoreSentiment,
} from "../../../src/providers/reddit.js";
import {
  resetRdtCommandRunnerForTests,
  setRdtCommandRunnerForTests,
} from "../../../src/providers/reddit-cli.js";
import commentsFixture from "../../fixtures/rdt-cli/read-1u1jsys.json";
import listingFixture from "../../fixtures/rdt-cli/sub-stocks.json";
import fixture from "../../fixtures/rdt-cli/sub-stocks.json";

describe("reddit provider", () => {
  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    resetRdtCommandRunnerForTests();
    vi.restoreAllMocks();
  });

  it("returns posts from subreddit", async () => {
    setRdtCommandRunnerForTests(
      vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify(fixture), stderr: "" }),
    );

    const result = await getSubredditPosts("wallstreetbets", 25);
    expect(result.subreddit).toBe("wallstreetbets");
    expect(result.postCount).toBe(1);
    expect(result.posts[0].title).toContain("$AAPL");
    expect(result.posts[0].score).toBe(542);
  });

  it("extracts ticker mentions from post titles", async () => {
    setRdtCommandRunnerForTests(
      vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify(fixture), stderr: "" }),
    );

    const result = await getSubredditPosts("wallstreetbets");
    expect(result.topMentions).toContain("AAPL");
  });

  it("caches results", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ code: 0, stdout: JSON.stringify(fixture), stderr: "" });
    setRdtCommandRunnerForTests(runner);

    await getSubredditPosts("wallstreetbets", 25);
    await getSubredditPosts("wallstreetbets", 25);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("includes sentiment score in results", async () => {
    setRdtCommandRunnerForTests(
      vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify(fixture), stderr: "" }),
    );

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
    setRdtCommandRunnerForTests(
      vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify(listingFixture), stderr: "" }),
    );

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
  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    resetRdtCommandRunnerForTests();
    vi.restoreAllMocks();
  });

  it("extracts top N comments by score", async () => {
    setRdtCommandRunnerForTests(
      vi.fn().mockResolvedValue({ code: 0, stdout: JSON.stringify(commentsFixture), stderr: "" }),
    );

    const comments = await getPostComments("stocks", "1u1jsys", 5);
    expect(comments).toHaveLength(2);
    expect(comments[0].author).toBe("launch_bull");
    expect(comments[0].score).toBe(41);
    expect(comments[0].body).toContain("bullish");
  });

  it("caches comments with 30-min TTL", async () => {
    const runner = vi
      .fn()
      .mockResolvedValue({ code: 0, stdout: JSON.stringify(commentsFixture), stderr: "" });
    setRdtCommandRunnerForTests(runner);

    await getPostComments("stocks", "1u1jsys", 5);
    await getPostComments("stocks", "1u1jsys", 5);
    expect(runner).toHaveBeenCalledTimes(1);
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
