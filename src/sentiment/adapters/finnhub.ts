import { randomUUID } from "node:crypto";
import type { FinnhubArticle } from "../../providers/finnhub.js";
import { extractEntities } from "../../routing/entity-extractor.js";
import type { SentinelRecord } from "../types.js";

const MAX_TICKERS = 3;

export class FinnhubAdapter {
  readonly source = "finnhub" as const;

  mapToRecords(articles: FinnhubArticle[], query: string): SentinelRecord[] {
    const fetchedAt = new Date().toISOString();
    return articles.map((article) => ({
      id: randomUUID(),
      source: this.source,
      sourceId: String(article.id),
      query,
      title: article.headline,
      text: article.summary,
      author: article.source,
      url: article.url,
      publishedAt: new Date(article.datetime * 1000).toISOString(),
      fetchedAt,
      engagement: {
        score: 0,
        replies: null,
        shares: null,
        views: null,
      },
      sentiment: {
        score: 0,
        confidence: 0,
        method: "keyword" as const,
        tickers: article.related
          ? article.related
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      },
      metadata: { category: article.category },
    }));
  }
}

export function extractTickersFromQuery(query: string): string[] {
  const entities = extractEntities(query);
  return entities.symbols.slice(0, MAX_TICKERS);
}
