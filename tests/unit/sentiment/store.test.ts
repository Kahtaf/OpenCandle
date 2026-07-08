import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SentimentStore } from "../../../src/sentiment/store.js";
import type { SentinelRecord } from "../../../src/sentiment/types.js";

function makeRecord(overrides: Partial<SentinelRecord> = {}): SentinelRecord {
  return {
    id: `test-${Math.random().toString(36).slice(2, 8)}`,
    source: "twitter",
    sourceId: `tweet-${Math.random().toString(36).slice(2, 8)}`,
    query: "AAPL",
    title: null,
    text: "AAPL is going to moon, very bullish",
    author: "@trader",
    url: "https://twitter.com/trader/status/12345",
    publishedAt: "2026-04-11T12:00:00Z",
    fetchedAt: new Date().toISOString(),
    engagement: { score: 100, replies: 5, shares: 10, views: 1000 },
    sentiment: { score: 0.5, confidence: 0.8, method: "keyword", tickers: ["AAPL"] },
    metadata: {},
    ...overrides,
  };
}

describe("SentimentStore", () => {
  describe("FTS5 availability", () => {
    it("better-sqlite3 supports FTS5 virtual tables", () => {
      const db = new Database(":memory:");
      expect(() => {
        db.exec("CREATE VIRTUAL TABLE test_fts USING fts5(content)");
      }).not.toThrow();
      db.close();
    });
  });

  let store: SentimentStore;

  beforeEach(() => {
    store = new SentimentStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  describe("schema", () => {
    it("creates schema_version table set to 1", () => {
      const version = store.getSchemaVersion();
      expect(version).toBe(1);
    });
  });

  describe("insert", () => {
    it("inserts a new record and finds it via search", () => {
      const rec = makeRecord({ text: "AAPL earnings beat expectations" });
      store.insert([rec]);
      const results = store.search("earnings");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].sourceId).toBe(rec.sourceId);
    });

    it("observation model: same sourceId different fetchedAt creates two rows", () => {
      const rec1 = makeRecord({ sourceId: "tweet-same", fetchedAt: "2026-04-10T12:00:00Z" });
      const rec2 = makeRecord({ sourceId: "tweet-same", fetchedAt: "2026-04-11T12:00:00Z" });
      store.insert([rec1]);
      store.insert([rec2]);
      const results = store.search("AAPL");
      const matching = results.filter((r) => r.sourceId === "tweet-same");
      expect(matching.length).toBe(2);
    });

    it("idempotent: same source, sourceId, fetchedAt inserts only once", () => {
      const rec = makeRecord({ sourceId: "tweet-dup", fetchedAt: "2026-04-11T12:00:00Z" });
      store.insert([rec]);
      store.insert([rec]);
      const results = store.search("AAPL");
      const matching = results.filter((r) => r.sourceId === "tweet-dup");
      expect(matching.length).toBe(1);
    });
  });

  describe("search", () => {
    it("returns BM25-ranked results", () => {
      const rec1 = makeRecord({ text: "AAPL earnings very bullish on AAPL" });
      const rec2 = makeRecord({ text: "random text with no ticker mentions" });
      store.insert([rec1, rec2]);
      const results = store.search("AAPL");
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].text).toContain("AAPL");
    });

    it("filters by source", () => {
      store.insert([
        makeRecord({ source: "twitter", text: "NVDA to the moon" }),
        makeRecord({ source: "reddit", text: "NVDA sentiment very bullish" }),
      ]);
      const results = store.search("NVDA", { source: "reddit" });
      expect(results.every((r) => r.source === "reddit")).toBe(true);
    });

    it("filters by time range", () => {
      store.insert([
        makeRecord({ text: "Fed rates", fetchedAt: "2026-04-08T12:00:00Z" }),
        makeRecord({ text: "Fed rates old", fetchedAt: "2026-04-01T12:00:00Z" }),
      ]);
      const results = store.search("Fed", { since: "2026-04-07", until: "2026-04-09" });
      expect(results.length).toBe(1);
      expect(results[0].text).toBe("Fed rates");
    });

    it("returns empty array for empty store", () => {
      const results = store.search("anything");
      expect(results).toEqual([]);
    });
  });

  describe("getByTicker", () => {
    it("returns records containing the ticker", () => {
      store.insert([
        makeRecord({
          sentiment: { score: 0.3, confidence: 0.7, method: "keyword", tickers: ["AAPL"] },
        }),
        makeRecord({
          sentiment: { score: -0.2, confidence: 0.6, method: "keyword", tickers: ["TSLA"] },
        }),
      ]);
      const results = store.getByTicker("AAPL");
      expect(results.length).toBe(1);
      expect(results[0].sentiment.tickers).toContain("AAPL");
    });

    it("handles dotted tickers like RY.TO", () => {
      store.insert([
        makeRecord({
          sentiment: { score: 0.1, confidence: 0.5, method: "keyword", tickers: ["RY.TO"] },
        }),
      ]);
      const results = store.getByTicker("RY.TO");
      expect(results.length).toBe(1);
    });

    it("handles hyphenated tickers like BTC-USD", () => {
      store.insert([
        makeRecord({
          sentiment: { score: 0.4, confidence: 0.6, method: "keyword", tickers: ["BTC-USD"] },
        }),
      ]);
      const results = store.getByTicker("BTC-USD");
      expect(results.length).toBe(1);
    });
  });

  describe("getTimeSeries", () => {
    it("returns per-source bucketed averages", () => {
      // Insert records across 2 days within the 7-day query window
      const dayMs = 24 * 60 * 60 * 1000;
      for (let daysAgo = 3; daysAgo >= 2; daysAgo--) {
        store.insert([
          makeRecord({
            source: "twitter",
            fetchedAt: new Date(Date.now() - daysAgo * dayMs).toISOString(),
            sentiment: {
              score: daysAgo === 3 ? 0.3 : 0.7,
              confidence: 0.8,
              method: "keyword",
              tickers: ["AAPL"],
            },
          }),
        ]);
      }
      const series = store.getTimeSeries("AAPL", { days: 7, bucketHours: 24 });
      expect(series.length).toBeGreaterThanOrEqual(1);
      for (const bucket of series) {
        expect(bucket).toHaveProperty("timestamp");
        expect(bucket).toHaveProperty("avgScore");
        expect(bucket).toHaveProperty("count");
      }
    });
  });

  describe("prune", () => {
    it("deletes records older than N days, retains newer ones", () => {
      const dayMs = 24 * 60 * 60 * 1000;
      const old = makeRecord({
        fetchedAt: new Date(Date.now() - 45 * dayMs).toISOString(),
        text: "old record about AAPL",
      });
      const recent = makeRecord({
        fetchedAt: new Date(Date.now() - 10 * dayMs).toISOString(),
        text: "recent record about AAPL",
      });
      store.insert([old, recent]);
      store.prune(30);
      const results = store.search("AAPL");
      expect(results.length).toBe(1);
      expect(results[0].text).toBe("recent record about AAPL");
    });
  });
});
