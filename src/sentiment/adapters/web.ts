import { randomUUID } from "node:crypto";
import type { WebSearchEnvelope } from "../../types/sentiment.js";
import type { SentimentAdapter, SentinelRecord } from "../types.js";

export class WebAdapter implements SentimentAdapter {
  readonly source = "web" as const;

  mapToRecords(envelope: WebSearchEnvelope, query: string): SentinelRecord[] {
    const fetchedAt = envelope.fetchedAt;
    return envelope.results.map((result) => ({
      id: randomUUID(),
      source: this.source,
      sourceId: canonicalizeUrl(result.url),
      query,
      title: result.title,
      text: result.snippet,
      author: result.source,
      url: result.url,
      publishedAt: result.published,
      fetchedAt,
      engagement: {
        score: 0,
        replies: null,
        shares: null,
        views: null,
      },
      sentiment: { score: 0, confidence: 0, method: "keyword" as const, tickers: [] },
      metadata: { category: result.category, provider: envelope.provider },
    }));
  }

  async fetch(_query: string, _options?: { hours?: number }): Promise<SentinelRecord[]> {
    throw new Error("Use pipeline.run() instead of adapter.fetch() directly");
  }
}

function canonicalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin + parsed.pathname;
  } catch {
    return url;
  }
}
