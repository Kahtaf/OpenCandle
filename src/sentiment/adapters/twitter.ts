import { randomUUID } from "node:crypto";
import type { TwitterSentimentResult } from "../../types/sentiment.js";
import type { SentimentAdapter, SentinelRecord } from "../types.js";

export class TwitterAdapter implements SentimentAdapter {
  readonly source = "twitter" as const;

  mapToRecords(result: TwitterSentimentResult, query: string): SentinelRecord[] {
    const fetchedAt = result.fetchedAt;
    return result.tweets.map((tweet) => ({
      id: randomUUID(),
      source: this.source,
      sourceId: tweet.id,
      query,
      title: null,
      text: tweet.text,
      author: tweet.author,
      url: tweet.url,
      publishedAt: tweet.created,
      fetchedAt,
      engagement: {
        score: tweet.likes,
        replies: tweet.replies,
        shares: tweet.retweets,
        views: tweet.views,
      },
      sentiment: { score: 0, confidence: 0, method: "keyword" as const, tickers: [] },
      metadata: {},
    }));
  }

  async fetch(_query: string, _options?: { hours?: number }): Promise<SentinelRecord[]> {
    // Actual fetching is done by the pipeline via the provider
    throw new Error("Use pipeline.run() instead of adapter.fetch() directly");
  }
}
