import { describe, expect, it } from "vitest";
import type { WebSearchEnvelope, WebSearchResult } from "../../../src/types/sentiment.js";

describe("WebSearchResult", () => {
  it("accepts a valid news result with all fields", () => {
    const result: WebSearchResult = {
      title: "AAPL Q1 Earnings Beat Expectations",
      url: "https://www.reuters.com/article/aapl-earnings",
      snippet: "Apple reported revenue of $124.3B, beating estimates.",
      source: "reuters.com",
      published: "2026-04-10T14:30:00Z",
      category: "news",
    };
    expect(result.title).toBe("AAPL Q1 Earnings Beat Expectations");
    expect(result.source).toBe("reuters.com");
    expect(result.published).toBe("2026-04-10T14:30:00Z");
    expect(result.category).toBe("news");
  });

  it("accepts a general result with null published date", () => {
    const result: WebSearchResult = {
      title: "What is a SPAC?",
      url: "https://www.investopedia.com/terms/s/spac.asp",
      snippet: "A special purpose acquisition company...",
      source: "investopedia.com",
      published: null,
      category: "general",
    };
    expect(result.published).toBeNull();
    expect(result.category).toBe("general");
  });
});

describe("WebSearchEnvelope", () => {
  it("wraps results with query metadata", () => {
    const envelope: WebSearchEnvelope = {
      query: "AAPL stock news",
      results: [
        {
          title: "Apple Earnings",
          url: "https://cnbc.com/apple",
          snippet: "Apple beat...",
          source: "cnbc.com",
          published: "2026-04-10T10:00:00Z",
          category: "news",
        },
      ],
      resultCount: 1,
      fetchedAt: "2026-04-11T08:00:00Z",
      provider: "ddg",
    };
    expect(envelope.query).toBe("AAPL stock news");
    expect(envelope.resultCount).toBe(1);
    expect(envelope.provider).toBe("ddg");
    expect(envelope.results).toHaveLength(1);
    expect(envelope.fetchedAt).toBe("2026-04-11T08:00:00Z");
  });

  it("accepts brave as provider", () => {
    const envelope: WebSearchEnvelope = {
      query: "Fed rate decision",
      results: [],
      resultCount: 0,
      fetchedAt: "2026-04-11T08:00:00Z",
      provider: "brave",
    };
    expect(envelope.provider).toBe("brave");
    expect(envelope.resultCount).toBe(0);
  });
});
