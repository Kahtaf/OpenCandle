import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    // Seed store with data across the past 6 days (within the 7-day query window)
    const dayMs = 24 * 60 * 60 * 1000;
    for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
      const ts = new Date(Date.now() - daysAgo * dayMs).toISOString();
      store.insert([
        {
          id: `test-${daysAgo}`,
          source: "twitter",
          sourceId: `tw-${daysAgo}`,
          query: "AAPL",
          title: null,
          text: "bullish on AAPL",
          author: "@trader",
          url: "https://example.com",
          publishedAt: ts,
          fetchedAt: ts,
          engagement: { score: 10, replies: null, shares: null, views: null },
          sentiment: {
            score: 0.3 + (6 - daysAgo) * 0.05,
            confidence: 0.7,
            method: "keyword",
            tickers: ["AAPL"],
          },
          metadata: {},
        },
      ]);
    }

    const result = await sentimentTrendTool.executeWithStore(
      "call-2",
      { query: "AAPL", days: 7 },
      store,
    );
    expect(result.content[0].text).toContain("Sentiment trend");
  });
});
