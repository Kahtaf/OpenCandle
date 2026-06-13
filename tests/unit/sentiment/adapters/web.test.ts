import { describe, expect, it } from "vitest";
import { WebAdapter } from "../../../../src/sentiment/adapters/web.js";
import type { WebSearchEnvelope } from "../../../../src/types/sentiment.js";

const mockEnvelope: WebSearchEnvelope = {
  query: "AAPL earnings",
  results: [
    {
      title: "Apple beats earnings expectations",
      url: "https://reuters.com/article/apple-earnings-2026",
      snippet: "Apple Inc reported quarterly revenue that beat Wall Street expectations.",
      source: "reuters.com",
      published: "2026-04-11T10:00:00Z",
      category: "news",
    },
    {
      title: "AAPL Stock Analysis",
      url: "https://seekingalpha.com/article/aapl-analysis",
      snippet: "AAPL stock continues to show strength after earnings.",
      source: "seekingalpha.com",
      published: null,
      category: "general",
    },
  ],
  resultCount: 2,
  fetchedAt: "2026-04-11T12:00:00Z",
  provider: "ddg",
};

describe("WebAdapter", () => {
  const adapter = new WebAdapter();

  it("has source web", () => {
    expect(adapter.source).toBe("web");
  });

  it("maps WebSearchResult to SentinelRecord", () => {
    const records = adapter.mapToRecords(mockEnvelope, "AAPL");
    expect(records).toHaveLength(2);

    const rec = records[0];
    expect(rec.source).toBe("web");
    expect(rec.query).toBe("AAPL");
    expect(rec.title).toBe("Apple beats earnings expectations");
    expect(rec.text).toContain("beat Wall Street expectations");
    expect(rec.author).toBe("reuters.com");
    expect(rec.publishedAt).toBe("2026-04-11T10:00:00Z");
    expect(rec.engagement.score).toBe(0);
    expect(rec.engagement.replies).toBeNull();
    expect(rec.engagement.shares).toBeNull();
    expect(rec.engagement.views).toBeNull();
  });

  it("handles nullable publishedAt", () => {
    const records = adapter.mapToRecords(mockEnvelope, "AAPL");
    expect(records[1].publishedAt).toBeNull();
  });

  it("uses URL origin+pathname as sourceId", () => {
    const records = adapter.mapToRecords(mockEnvelope, "AAPL");
    expect(records[0].sourceId).toContain("reuters.com");
  });
});
