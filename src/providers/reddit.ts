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
    headers: { "User-Agent": "Vantage/1.0 (financial analysis agent)" },
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

  const result: RedditSentimentResult = {
    subreddit,
    postCount: posts.length,
    posts,
    topMentions,
    fetchedAt: new Date().toISOString(),
  };

  cache.set(cacheKey, result, TTL.SENTIMENT);
  return result;
}
