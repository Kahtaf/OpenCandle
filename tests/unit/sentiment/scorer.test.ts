import { describe, expect, it } from "vitest";
import { keywordScore, scoreRecords } from "../../../src/sentiment/scorer.js";
import type { SentinelRecord } from "../../../src/sentiment/types.js";

function makeRecord(overrides: Partial<SentinelRecord> = {}): SentinelRecord {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    source: "twitter",
    sourceId: "tweet-123",
    query: "AAPL",
    title: null,
    text: "some text",
    author: "@trader",
    url: "https://twitter.com/trader/status/123",
    publishedAt: "2026-04-11T12:00:00Z",
    fetchedAt: "2026-04-11T12:01:00Z",
    engagement: { score: 0, replies: null, shares: null, views: null },
    sentiment: { score: 0, confidence: 0, method: "keyword", tickers: [] },
    metadata: {},
    ...overrides,
  };
}

describe("keywordScore", () => {
  it("scores bullish text positive", () => {
    const rec = makeRecord({ text: "AAPL is going to moon, very bullish" });
    const result = keywordScore(rec);
    expect(result.score).toBeGreaterThan(0);
  });

  it("scores bearish text negative", () => {
    const rec = makeRecord({ text: "crash incoming, sell everything, puts on this" });
    const result = keywordScore(rec);
    expect(result.score).toBeLessThan(0);
  });

  it("scores neutral text at 0 with 0 confidence", () => {
    const rec = makeRecord({ text: "AAPL reported earnings today" });
    const result = keywordScore(rec);
    expect(result.score).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it("high-engagement bearish outweighs low-engagement bullish", () => {
    const bearish = makeRecord({
      text: "crash incoming",
      engagement: { score: 500, replies: null, shares: null, views: null },
    });
    const bullish = makeRecord({
      text: "bullish on this",
      engagement: { score: 10, replies: null, shares: null, views: null },
    });
    const bearishResult = keywordScore(bearish);
    const bullishResult = keywordScore(bullish);
    // bearish weighted score should have higher absolute value due to engagement
    expect(Math.abs(bearishResult.score) * (1 + 500)).toBeGreaterThan(
      Math.abs(bullishResult.score) * (1 + 10),
    );
  });

  it("confidence higher for longer text with multiple keywords", () => {
    const short = makeRecord({ text: "bullish" });
    const long = makeRecord({
      text: "Very bullish on AAPL, undervalued and a great breakout candidate. I'm going long, accumulate on dips.",
    });
    const shortResult = keywordScore(short);
    const longResult = keywordScore(long);
    expect(longResult.confidence).toBeGreaterThan(shortResult.confidence);
  });

  it("twitter source gets confidence penalty", () => {
    const tweet = makeRecord({ source: "twitter", text: "bullish on this moon shot" });
    const reddit = makeRecord({ source: "reddit", text: "bullish on this moon shot" });
    const tweetResult = keywordScore(tweet);
    const redditResult = keywordScore(reddit);
    expect(tweetResult.confidence).toBeLessThan(redditResult.confidence);
  });

  it("extracts tickers from text", () => {
    const rec = makeRecord({ text: "$AAPL is mooning, also watching $TSLA" });
    const result = keywordScore(rec);
    expect(result.tickers).toContain("AAPL");
    expect(result.tickers).toContain("TSLA");
  });
});

describe("scoreRecords", () => {
  it("scores a batch of records with method keyword", () => {
    const records = [
      makeRecord({ text: "bullish on AAPL" }),
      makeRecord({ text: "crash is coming" }),
      makeRecord({ text: "neutral text about earnings" }),
    ];
    const scored = scoreRecords(records);
    expect(scored).toHaveLength(3);
    for (const r of scored) {
      expect(r.sentiment.method).toBe("keyword");
    }
  });

  it("returns empty array for empty input", () => {
    expect(scoreRecords([])).toEqual([]);
  });

  it("populates tickers from text", () => {
    const records = [makeRecord({ text: "$NVDA to the moon" })];
    const scored = scoreRecords(records);
    expect(scored[0].sentiment.tickers).toContain("NVDA");
  });
});
