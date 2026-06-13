import { describe, expect, it } from "vitest";
import {
  isSentinelRecord,
  SENTIMENT_SOURCES,
  type SentinelRecord,
} from "../../../src/sentiment/types.js";

describe("SentinelRecord types", () => {
  const validRecord: SentinelRecord = {
    id: "test-uuid-1",
    source: "twitter",
    sourceId: "tweet-12345",
    query: "AAPL",
    title: null,
    text: "AAPL is going to moon",
    author: "@trader",
    url: "https://twitter.com/trader/status/12345",
    publishedAt: "2026-04-11T12:00:00Z",
    fetchedAt: "2026-04-11T12:01:00Z",
    engagement: {
      score: 100,
      replies: 5,
      shares: 10,
      views: 1000,
    },
    sentiment: {
      score: 0.5,
      confidence: 0.8,
      method: "keyword",
      tickers: ["AAPL"],
    },
    metadata: {},
  };

  describe("isSentinelRecord", () => {
    it("accepts a valid record", () => {
      expect(isSentinelRecord(validRecord)).toBe(true);
    });

    it("accepts publishedAt as null", () => {
      const rec = { ...validRecord, publishedAt: null };
      expect(isSentinelRecord(rec)).toBe(true);
    });

    it("accepts nullable engagement fields", () => {
      const rec = {
        ...validRecord,
        engagement: { score: 0, replies: null, shares: null, views: null },
      };
      expect(isSentinelRecord(rec)).toBe(true);
    });

    it("rejects sentiment score outside [-1, 1]", () => {
      const rec = {
        ...validRecord,
        sentiment: { ...validRecord.sentiment, score: 1.5 },
      };
      expect(isSentinelRecord(rec)).toBe(false);
    });

    it("rejects sentiment score below -1", () => {
      const rec = {
        ...validRecord,
        sentiment: { ...validRecord.sentiment, score: -1.1 },
      };
      expect(isSentinelRecord(rec)).toBe(false);
    });

    it("rejects confidence outside [0, 1]", () => {
      const rec = {
        ...validRecord,
        sentiment: { ...validRecord.sentiment, confidence: 1.2 },
      };
      expect(isSentinelRecord(rec)).toBe(false);
    });

    it("rejects confidence below 0", () => {
      const rec = {
        ...validRecord,
        sentiment: { ...validRecord.sentiment, confidence: -0.1 },
      };
      expect(isSentinelRecord(rec)).toBe(false);
    });

    it("rejects invalid source values", () => {
      const rec = { ...validRecord, source: "discord" as any };
      expect(isSentinelRecord(rec)).toBe(false);
    });

    it("rejects missing required fields", () => {
      const { text, ...noText } = validRecord;
      expect(isSentinelRecord(noText)).toBe(false);
    });
  });

  describe("SENTIMENT_SOURCES", () => {
    it("contains twitter, reddit, and web", () => {
      expect(SENTIMENT_SOURCES).toContain("twitter");
      expect(SENTIMENT_SOURCES).toContain("reddit");
      expect(SENTIMENT_SOURCES).toContain("web");
    });

    it("has exactly 4 sources", () => {
      expect(SENTIMENT_SOURCES).toHaveLength(4);
      expect(SENTIMENT_SOURCES).toContain("finnhub");
    });
  });
});
