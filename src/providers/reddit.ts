import { httpGet } from "../infra/http-client.js";
import { cache, TTL } from "../infra/cache.js";
import type { RedditSentimentResult } from "../types/sentiment.js";

interface RedditListingResponse {
  data: {
    children: Array<{
      data: {
        title: string;
        score: number;
        num_comments: number;
        permalink: string;
        created_utc: number;
      };
    }>;
  };
}

export async function getSubredditPosts(
  subreddit: string,
  limit: number = 25,
): Promise<RedditSentimentResult> {
  const cacheKey = `reddit:${subreddit}:${limit}`;
  const cached = cache.get<RedditSentimentResult>(cacheKey);
  if (cached) return cached;

  const url = `https://www.reddit.com/r/${encodeURIComponent(subreddit)}/hot.json?limit=${limit}`;
  const data = await httpGet<RedditListingResponse>(url, {
    headers: { "User-Agent": "OpenCandle/1.0 (financial analysis agent)" },
  });

  const posts = data.data.children.map((child) => ({
    title: child.data.title,
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
}

const BULLISH_TERMS = [
  "moon", "buy", "undervalued", "breakout", "calls", "bullish",
  "rocket", "diamond hands", "accumulate", "dip buy", "long", "rip", "squeeze",
];

const BEARISH_TERMS = [
  "crash", "overvalued", "sell", "puts", "bearish", "bubble",
  "dump", "short", "bagholding", "exit", "drill", "tank", "rug",
];

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
