import { httpGet } from "../infra/http-client.js";
import { cache, TTL, STALE_LIMIT } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { RedditSentimentResult } from "../types/sentiment.js";
import { BULLISH_TERMS, BEARISH_TERMS } from "../sentiment/keywords.js";

interface RedditListingResponse {
  data: {
    children: Array<{
      data: {
        id: string;
        title: string;
        selftext: string;
        author: string;
        score: number;
        num_comments: number;
        permalink: string;
        created_utc: number;
      };
    }>;
  };
}

const REDDIT_HEADERS = { "User-Agent": "OpenCandle/1.0 (financial analysis agent)" };

export async function getSubredditPosts(
  subreddit: string,
  limit: number = 25,
): Promise<RedditSentimentResult> {
  const cacheKey = `reddit:${subreddit}:${limit}`;
  const cached = cache.get<RedditSentimentResult>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("reddit");
    const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.json?limit=${limit}`;
    const data = await httpGet<RedditListingResponse>(url, {
      headers: REDDIT_HEADERS,
    });

    const posts = data.data.children.map((child) => ({
      id: child.data.id,
      title: child.data.title,
      selftext: child.data.selftext ?? "",
      author: child.data.author ?? "unknown",
      score: child.data.score,
      comments: child.data.num_comments,
      url: `https://reddit.com${child.data.permalink}`,
      created: new Date(child.data.created_utc * 1000).toISOString(),
    }));

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
  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/comments/${postId}.json`;
  const data = await httpGet<Array<{ data: { children: Array<{ kind: string; data: { id: string; body?: string; author?: string; score?: number; permalink?: string } }> } }>>(url, {
    headers: REDDIT_HEADERS,
  });

  // Comments are in the second listing element
  const commentListing = data[1]?.data?.children ?? [];
  const comments: RedditComment[] = commentListing
    .filter((c) => c.kind === "t1" && c.data.body)
    .sort((a, b) => (b.data.score ?? 0) - (a.data.score ?? 0))
    .slice(0, limit)
    .map((c) => ({
      id: c.data.id,
      body: c.data.body!,
      author: c.data.author ?? "unknown",
      score: c.data.score ?? 0,
      permalink: `https://reddit.com${c.data.permalink ?? ""}`,
    }));

  cache.set(cacheKey, comments, COMMENT_TTL);
  return comments;
}

// ── Sentiment scoring ───────────────────────────────────

export function scoreSentiment(
  posts: Array<{ title: string }>,
): { score: number; bullish: number; bearish: number } {
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
