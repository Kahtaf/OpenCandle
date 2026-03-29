import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getSubredditPosts } from "../../../src/providers/reddit.js";
import { cache } from "../../../src/infra/cache.js";
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
});
