import { existsSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Scraper, SearchMode } from "@the-convocation/twitter-scraper";
import { cache, TTL, STALE_LIMIT } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import { getBrowserProfileDir } from "../infra/opencandle-paths.js";
import type { TwitterSentimentResult, TwitterTweet } from "../types/sentiment.js";

// ── Cookie extraction ────────────────────────────────────

interface FirefoxCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
}

export function readTwitterCookies(profileDir: string): FirefoxCookie[] {
  const dbPath = join(profileDir, "cookies.sqlite");
  if (!existsSync(dbPath)) return [];

  const db = new Database(dbPath, { readonly: true });
  try {
    const rows = db
      .prepare(
        `SELECT name, value, host AS domain, path FROM moz_cookies WHERE host LIKE ? OR host LIKE ?`,
      )
      .all("%x.com%", "%twitter.com%") as FirefoxCookie[];
    return rows;
  } finally {
    db.close();
  }
}

// ── Sentiment scoring ────────────────────────────────────

const BULLISH_TERMS = [
  "moon", "buy", "undervalued", "breakout", "calls", "bullish",
  "rocket", "diamond hands", "accumulate", "dip buy", "long", "rip", "squeeze",
];

const BEARISH_TERMS = [
  "crash", "overvalued", "sell", "puts", "bearish", "bubble",
  "dump", "short", "bagholding", "exit", "drill", "tank", "rug",
];

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
  if (/^[A-Z]{1,5}$/.test(query)) return "$" + query;
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
    const profileDir = getBrowserProfileDir();
    const cookies = readTwitterCookies(profileDir);

    const authToken = cookies.find((c) => c.name === "auth_token");
    const ct0 = cookies.find((c) => c.name === "ct0");

    if (!authToken || !ct0) {
      throw new Error("No Twitter session found.");
    }

    const scraper = new Scraper();
    const cookieStrings = cookies.map(
      (c) => `${c.name}=${c.value}; Domain=${c.domain}; Path=${c.path}`,
    );
    await scraper.setCookies(cookieStrings);

    const loggedIn = await scraper.isLoggedIn();
    if (!loggedIn) {
      throw new Error("Twitter session expired.");
    }

    const cutoff = new Date(Date.now() - hours * 3_600_000);
    const tweets: TwitterTweet[] = [];
    const results = scraper.searchTweets(normalizedQuery, limit, SearchMode.Latest);

    for await (const tweet of results) {
      const created = tweet.timeParsed ?? new Date(0);
      if (created < cutoff) continue;

      tweets.push({
        text: tweet.text?.slice(0, 280) ?? "",
        author: tweet.username ?? "unknown",
        likes: tweet.likes ?? 0,
        retweets: tweet.retweets ?? 0,
        replies: tweet.replies ?? 0,
        views: tweet.views ?? null,
        url: tweet.permanentUrl ?? "",
        created: created.toISOString(),
      });

      if (tweets.length >= limit) break;
    }

    // Extract co-mentioned cashtags
    const tickerRegex = /\$([A-Z]{1,5})\b/g;
    const mentionCounts = new Map<string, number>();
    // Exclude the searched ticker itself from co-mentions
    const searchedTicker = normalizedQuery.startsWith("$")
      ? normalizedQuery.slice(1)
      : null;
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
