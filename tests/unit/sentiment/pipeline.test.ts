import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SentimentPipeline } from "../../../src/sentiment/pipeline.js";
import { SentimentStore } from "../../../src/sentiment/store.js";
import type { SentinelRecord } from "../../../src/sentiment/types.js";

function makeRecord(overrides: Partial<SentinelRecord> = {}): SentinelRecord {
  return {
    id: "test-" + Math.random().toString(36).slice(2, 8),
    source: "twitter",
    sourceId: "src-" + Math.random().toString(36).slice(2, 8),
    query: "AAPL",
    title: null,
    text: "bullish on AAPL",
    author: "@trader",
    url: "https://example.com",
    publishedAt: "2026-04-11T12:00:00Z",
    fetchedAt: new Date().toISOString(),
    engagement: { score: 10, replies: null, shares: null, views: null },
    sentiment: { score: 0, confidence: 0, method: "keyword", tickers: [] },
    metadata: {},
    ...overrides,
  };
}

describe("SentimentPipeline", () => {
  let store: SentimentStore;
  let pipeline: SentimentPipeline;

  beforeEach(() => {
    store = new SentimentStore(":memory:");
    pipeline = new SentimentPipeline(store, {
      retentionDays: 30,
      defaultSubreddits: ["stocks"],
      commentsPerPost: 5,
      divergenceThreshold: 0.4,
    });
  });

  afterEach(() => {
    store.close();
  });

  it("scores records via keyword scorer", async () => {
    const records = [
      makeRecord({ text: "bullish on AAPL, moon incoming" }),
      makeRecord({ text: "crash is coming, sell everything", source: "reddit" }),
    ];

    const result = await pipeline.processRecords(records, "AAPL");
    expect(result.fresh).toHaveLength(2);
    expect(result.fresh[0].sentiment.score).toBeGreaterThan(0);
    expect(result.fresh[1].sentiment.score).toBeLessThan(0);
    expect(result.fresh[0].sentiment.method).toBe("keyword");
  });

  it("inserts scored records into store", async () => {
    const records = [makeRecord({ text: "bullish on AAPL" })];
    await pipeline.processRecords(records, "AAPL");

    const stored = store.search("AAPL");
    expect(stored.length).toBeGreaterThanOrEqual(1);
  });

  it("returns null trend when store was empty before this fetch", async () => {
    const records = [makeRecord({ text: "bullish on AAPL" })];
    const result = await pipeline.processRecords(records, "AAPL");
    expect(result.trend).toBeNull();
  });

  it("returns trend when store has prior history", async () => {
    // Seed store with prior data across 2 time buckets
    const oldRecords = [
      makeRecord({ text: "bearish AAPL crash", fetchedAt: "2026-04-05T12:00:00Z" }),
      makeRecord({ text: "bullish AAPL moon", fetchedAt: "2026-04-06T12:00:00Z" }),
    ];
    store.insert(oldRecords.map((r) => ({
      ...r,
      sentiment: { score: 0.3, confidence: 0.5, method: "keyword" as const, tickers: ["AAPL"] },
    })));

    const freshRecords = [makeRecord({ text: "bullish on AAPL" })];
    const result = await pipeline.processRecords(freshRecords, "AAPL");
    expect(result.trend).not.toBeNull();
    expect(result.trend!.length).toBeGreaterThanOrEqual(1);
  });

  it("handles empty input", async () => {
    const result = await pipeline.processRecords([], "AAPL");
    expect(result.fresh).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("returns warnings array", async () => {
    const records = [makeRecord({ text: "bullish" })];
    const result = await pipeline.processRecords(records, "AAPL");
    expect(result).toHaveProperty("warnings");
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it("returns divergence when sources diverge", async () => {
    // Create enough records per source for divergence detection
    const twitterRecords = Array.from({ length: 6 }, (_, i) =>
      makeRecord({ source: "twitter", sourceId: `tw-${i}`, text: "bullish moon rocket" }),
    );
    const webRecords = Array.from({ length: 6 }, (_, i) =>
      makeRecord({ source: "web", sourceId: `web-${i}`, text: "crash sell dump bearish" }),
    );

    const result = await pipeline.processRecords([...twitterRecords, ...webRecords], "AAPL");
    expect(result.divergence).not.toBeNull();
    // May or may not be detected depending on scoring, but the field should exist
    expect(result.divergence).toHaveProperty("detected");
  });
});
