import { randomUUID } from "node:crypto";
import type { RedditComment } from "../../providers/reddit.js";
import type { RedditSentimentResult } from "../../types/sentiment.js";
import type { SentimentAdapter, SentinelRecord } from "../types.js";

export class RedditAdapter implements SentimentAdapter {
  readonly source = "reddit" as const;

  mapPostsToRecords(result: RedditSentimentResult, query: string): SentinelRecord[] {
    const fetchedAt = result.fetchedAt;
    return result.posts.map((post) => ({
      id: randomUUID(),
      source: this.source,
      sourceId: post.id,
      query,
      title: post.title,
      text: post.selftext ? `${post.title}\n${post.selftext}` : post.title,
      author: post.author,
      url: post.url,
      publishedAt: post.created,
      fetchedAt,
      engagement: {
        score: post.score,
        replies: post.comments,
        shares: null,
        views: null,
      },
      sentiment: { score: 0, confidence: 0, method: "keyword" as const, tickers: [] },
      metadata: { subreddit: result.subreddit },
    }));
  }

  mapCommentsToRecords(
    comments: RedditComment[],
    parentId: string,
    subreddit: string,
    query: string,
  ): SentinelRecord[] {
    const fetchedAt = new Date().toISOString();
    return comments.map((comment) => ({
      id: randomUUID(),
      source: this.source,
      sourceId: comment.id,
      query,
      title: null,
      text: comment.body,
      author: comment.author,
      url: comment.permalink,
      publishedAt: null,
      fetchedAt,
      engagement: {
        score: comment.score,
        replies: null,
        shares: null,
        views: null,
      },
      sentiment: { score: 0, confidence: 0, method: "keyword" as const, tickers: [] },
      metadata: { isComment: true, parentId, subreddit },
    }));
  }

  async fetch(_query: string, _options?: { hours?: number }): Promise<SentinelRecord[]> {
    throw new Error("Use pipeline.run() instead of adapter.fetch() directly");
  }
}
