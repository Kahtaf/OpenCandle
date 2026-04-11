import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import type { RedditSentimentResult } from "../../../src/types/sentiment.js";
import type { ProviderResult } from "../../../src/runtime/evidence.js";
import listingFixture from "../../fixtures/reddit/listing-with-ids.json";

const originalFetch = globalThis.fetch;

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

import { redditSentimentTool } from "../../../src/tools/sentiment/reddit-sentiment.js";

beforeEach(() => { cache.clear(); });
afterEach(() => { globalThis.fetch = originalFetch; vi.restoreAllMocks(); });

describe("get_reddit_sentiment tool", () => {
  it("has correct tool name", () => {
    expect(redditSentimentTool.name).toBe("get_reddit_sentiment");
  });

  it("supports subreddit param for backward compatibility", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(listingFixture),
    });

    const result = await redditSentimentTool.execute("call-1", { subreddit: "stocks" });
    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toContain("Reddit");
  });

  it("supports query param for topic filtering", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(listingFixture),
    });

    const result = await redditSentimentTool.execute("call-2", { subreddit: "stocks", query: "AAPL" });
    expect(result.content[0].text).toContain("AAPL");
  });
});
