import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SentimentStore } from "../../../src/sentiment/store.js";
import { sentimentTrendTool } from "../../../src/tools/sentiment/sentiment-trend.js";

describe("get_sentiment_trend tool", () => {
  let store: SentimentStore;

  beforeEach(() => {
    store = new SentimentStore(":memory:");
  });

  afterEach(() => {
    store.close();
  });

  it("has correct tool name", () => {
    expect(sentimentTrendTool.name).toBe("get_sentiment_trend");
  });

  it("returns no data message for empty store", async () => {
    const result = await sentimentTrendTool.executeWithStore("call-1", { query: "AAPL" }, store);
    expect(result.content[0].text).toContain("No historical sentiment data");
  });

  it("returns sparklines for populated store", async () => {
    // Seed store with data across multiple days
    for (let day = 5; day <= 11; day++) {
      store.insert([{
        id: `test-${day}`,
        source: "twitter",
        sourceId: `tw-${day}`,
        query: "AAPL",
        title: null,
        text: "bullish on AAPL",
        author: "@trader",
        url: "https://example.com",
        publishedAt: `2026-04-${String(day).padStart(2, "0")}T12:00:00Z`,
        fetchedAt: `2026-04-${String(day).padStart(2, "0")}T12:00:00Z`,
        engagement: { score: 10, replies: null, shares: null, views: null },
        sentiment: { score: 0.3 + day * 0.05, confidence: 0.7, method: "keyword", tickers: ["AAPL"] },
        metadata: {},
      }]);
    }

    const result = await sentimentTrendTool.executeWithStore("call-2", { query: "AAPL", days: 7 }, store);
    expect(result.content[0].text).toContain("Sentiment trend");
  });
});
