import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { TwitterSentimentResult, TwitterTweet } from "../types/sentiment.js";
import { searchTweets } from "./twitter-cli.js";

// ── Sentiment scoring ────────────────────────────────────

import { BEARISH_TERMS, BULLISH_TERMS } from "../sentiment/keywords.js";

export function scoreTwitterSentiment(
  tweets: Array<{ text: string; likes: number; retweets: number }>,
): { score: number; bullish: number; bearish: number } {
  let bullishWeight = 0;
  let bearishWeight = 0;
  let bullishCount = 0;
  let bearishCount = 0;

  for (const tweet of tweets) {
    const lower = tweet.text.toLowerCase();
    const engagement = 1 + (tweet.likes ?? 0) + (tweet.retweets ?? 0);
    const tweetBullish = BULLISH_TERMS.filter((t) => lower.includes(t)).length;
    const tweetBearish = BEARISH_TERMS.filter((t) => lower.includes(t)).length;

    bullishCount += tweetBullish;
    bearishCount += tweetBearish;
    bullishWeight += tweetBullish * engagement;
    bearishWeight += tweetBearish * engagement;
  }

  const totalWeight = bullishWeight + bearishWeight;
  return {
    score: totalWeight === 0 ? 0 : (bullishWeight - bearishWeight) / totalWeight,
    bullish: bullishCount,
    bearish: bearishCount,
  };
}

// ── Query normalization ──────────────────────────────────

export function normalizeQuery(query: string): string {
  if (/^[A-Z]{1,5}$/.test(query)) return `$${query}`;
  return query;
}

// ── Main provider function ───────────────────────────────

export async function getTwitterSentiment(
  query: string,
  limit: number = 50,
  hours: number = 24,
): Promise<TwitterSentimentResult> {
  const normalizedQuery = normalizeQuery(query);
  const cacheKey = `twitter:${normalizedQuery}:${limit}:${hours}`;
  const cached = cache.get<TwitterSentimentResult>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("twitter");

  try {
    const cutoff = new Date(Date.now() - hours * 3_600_000);
    const tweets: TwitterTweet[] = (await searchTweets(normalizedQuery, limit))
      .filter((tweet) => new Date(tweet.created) >= cutoff)
      .slice(0, limit);

    // Extract co-mentioned cashtags
    const tickerRegex = /\$([A-Z]{1,5})\b/g;
    const mentionCounts = new Map<string, number>();
    // Exclude the searched ticker itself from co-mentions
    const searchedTicker = normalizedQuery.startsWith("$") ? normalizedQuery.slice(1) : null;
    for (const t of tweets) {
      for (const match of t.text.matchAll(tickerRegex)) {
        const ticker = match[1];
        if (ticker === searchedTicker) continue;
        mentionCounts.set(ticker, (mentionCounts.get(ticker) ?? 0) + 1);
      }
    }
    const topMentions = [...mentionCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([ticker]) => ticker);

    const sentiment = scoreTwitterSentiment(tweets);

    const result: TwitterSentimentResult = {
      query: normalizedQuery,
      tweetCount: tweets.length,
      tweets,
      sentimentScore: sentiment.score,
      bullishCount: sentiment.bullish,
      bearishCount: sentiment.bearish,
      topMentions,
      fetchedAt: new Date().toISOString(),
    };

    cache.set(cacheKey, result, TTL.SENTIMENT);
    return result;
  } catch (error) {
    const stale = cache.getStale<TwitterSentimentResult>(cacheKey, STALE_LIMIT.SENTIMENT);
    if (stale) return stale.value;
    throw error;
  }
}
