import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import { BEARISH_TERMS, BULLISH_TERMS } from "../sentiment/keywords.js";
import type { RedditSentimentResult } from "../types/sentiment.js";
import { listSubredditPosts, readRedditPost, searchRedditPosts } from "./reddit-cli.js";

export async function getSubredditPosts(
  subreddit: string,
  limit: number = 25,
  query?: string,
): Promise<RedditSentimentResult> {
  const cacheKey = `reddit:${subreddit}:${query ?? "hot"}:${limit}`;
  const cached = cache.get<RedditSentimentResult>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("reddit");
    const posts = query
      ? await searchRedditPosts(query, { subreddit, limit })
      : await listSubredditPosts(subreddit, { limit });

    // Extract ticker-like mentions ($AAPL, $TSLA, etc.)
    const tickerRegex = /\$([A-Z]{1,5})\b/g;
    const mentionCounts = new Map<string, number>();
    for (const post of posts) {
      for (const match of post.title.matchAll(tickerRegex)) {
        const ticker = match[1];
        mentionCounts.set(ticker, (mentionCounts.get(ticker) ?? 0) + 1);
      }
    }
    const topMentions = [...mentionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ticker]) => ticker);

    const sentiment = scoreSentiment(posts);

    const result: RedditSentimentResult = {
      subreddit,
      postCount: posts.length,
      posts,
      topMentions,
      sentimentScore: sentiment.score,
      bullishCount: sentiment.bullish,
      bearishCount: sentiment.bearish,
      fetchedAt: new Date().toISOString(),
    };

    cache.set(cacheKey, result, TTL.SENTIMENT);
    return result;
  } catch (error) {
    const stale = cache.getStale<RedditSentimentResult>(cacheKey, STALE_LIMIT.SENTIMENT);
    if (stale) return stale.value;
    throw error;
  }
}

// ── Comment fetching ────────────────────────────────────

export interface RedditComment {
  id: string;
  body: string;
  author: string;
  score: number;
  permalink: string;
}

const COMMENT_TTL = 30 * 60 * 1000; // 30 minutes

export async function getPostComments(
  subreddit: string,
  postId: string,
  limit: number = 5,
): Promise<RedditComment[]> {
  const cacheKey = `reddit:comments:${subreddit}:${postId}:${limit}`;
  const cached = cache.get<RedditComment[]>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("reddit_comments");
  const { comments } = await readRedditPost(postId, { limit });

  cache.set(cacheKey, comments, COMMENT_TTL);
  return comments;
}

// ── Sentiment scoring ───────────────────────────────────

export function scoreSentiment(posts: Array<{ title: string }>): {
  score: number;
  bullish: number;
  bearish: number;
} {
  let bullish = 0;
  let bearish = 0;
  for (const post of posts) {
    const lower = post.title.toLowerCase();
    bullish += BULLISH_TERMS.filter((t) => lower.includes(t)).length;
    bearish += BEARISH_TERMS.filter((t) => lower.includes(t)).length;
  }
  const total = bullish + bearish;
  return {
    score: total === 0 ? 0 : (bullish - bearish) / total,
    bullish,
    bearish,
  };
}
