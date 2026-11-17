import assert from "node:assert/strict";
import { getConfig, resetConfigCache } from "../../src/config.js";
import { cache } from "../../src/infra/cache.js";
import { exaSearch } from "../../src/providers/exa-search.js";
import { getPostComments, getSubredditPosts } from "../../src/providers/reddit.js";
import type { WebSearchOpts } from "../../src/providers/web-search.js";
import type { TwitterSentimentResult, WebSearchEnvelope } from "../../src/types/sentiment.js";
import { type CanaryCase, skip } from "./live-canary-results.js";
import type { SmokeToolLike } from "./provider-release-smoke.js";

const QUERY = "Federal Reserve interest rates";

function verifySearch(data: WebSearchEnvelope, provider: string, nonempty = true): void {
  assert.equal(data.provider, provider);
  assert.equal(data.resultCount, data.results.length);
  if (nonempty) assert.ok(data.results.length > 0, "known-positive search returned no results");
  assert.ok(Number.isFinite(Date.parse(data.fetchedAt)), "missing retrieval timestamp");
  for (const result of data.results) {
    assert.ok(result.title.trim() && result.source.trim(), "missing title or source");
    assert.match(result.url, /^https?:\/\//);
    if (result.published !== null) assert.ok(Number.isFinite(Date.parse(result.published)));
  }
}

function required(name: string, run: () => Promise<void>): CanaryCase {
  return {
    name,
    run: async () => {
      cache.clear();
      try {
        await run();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (
          /forbidden|challenge|cooling down|not installed|not authenticated|no cookies|rate.limit|HTTP 429|HTTP 402/i.test(
            message,
          )
        ) {
          skip(message);
        }
        throw error;
      }
    },
  };
}

export async function getSearchContractCases(): Promise<CanaryCase[]> {
  const { getAllTools } = await import("../../src/tools/index.js");
  const tools = getAllTools();
  const web: SmokeToolLike | undefined = tools.find((tool) => tool.name === "search_web");
  const twitter: SmokeToolLike | undefined = tools.find(
    (tool) => tool.name === "get_twitter_sentiment",
  );
  assert.ok(web && twitter, "search/social registered tools missing");
  const searchCase = (
    provider: "brave" | "exa" | "ddg",
    category: "general" | "news",
    freshness: WebSearchOpts["freshness"],
  ): CanaryCase =>
    required(`${provider}:${category}-${freshness}`, async () => {
      if (provider === "brave" && !getConfig().braveApiKey) skip("BRAVE_API_KEY unavailable");
      if (provider === "exa" && !getConfig().exaApiKey)
        skip("EXA_API_KEY unavailable for direct API proof");
      const result = await web.execute("provider-contract-search", {
        query: QUERY,
        provider,
        category,
        freshness,
        limit: 3,
      });
      assert.ok(result.details, JSON.stringify(result.content));
      const data = result.details as WebSearchEnvelope;
      verifySearch(data, provider, freshness !== "hours");
      for (const item of data.results) {
        assert.equal(item.category, category);
        if (provider === "brave" && freshness === "hours") {
          assert.ok(item.published, "strict hour result has no source date");
          const age = Date.now() - Date.parse(item.published);
          assert.ok(age >= 0 && age <= 3_600_000, "result outside requested hour");
        }
      }
      if (provider === "brave" && freshness === "week") {
        assert.ok(
          data.results.some((item) => item.published !== null),
          "Brave discarded all source dates",
        );
      }
    });
  return [
    ...(["general", "news"] as const).flatMap((category) => [
      searchCase("brave", category, "week"),
      searchCase("brave", category, "hours"),
      searchCase("exa", category, "week"),
    ]),
    ...(["general", "news"] as const).map((category) =>
      required(`exa:mcp-${category}`, async () => {
        const previous = process.env.EXA_API_KEY;
        process.env.EXA_API_KEY = "";
        resetConfigCache();
        try {
          const data = await exaSearch(QUERY, { category, freshness: "week", limit: 3 });
          verifySearch(data, "exa");
          assert.ok(data.results.every((item) => item.category === category));
        } finally {
          if (previous === undefined) delete process.env.EXA_API_KEY;
          else process.env.EXA_API_KEY = previous;
          resetConfigCache();
        }
      }),
    ),
    searchCase("ddg", "general", "week"),
    searchCase("ddg", "news", "week"),
    required("twitter:sentiment-citations", async () => {
      const result = await twitter.execute("provider-contract-search", {
        query: "AAPL",
        limit: 3,
        hours: 24,
      });
      assert.ok(result.details, JSON.stringify(result.content));
      const data = result.details as TwitterSentimentResult;
      assert.ok(data.tweetCount > 0);
      assert.equal(data.tweetCount, data.tweets.length);
      assert.ok(Number.isFinite(Date.parse(data.fetchedAt)));
      for (const tweet of data.tweets) {
        assert.match(tweet.id, /^\d+$/);
        assert.match(
          tweet.url,
          new RegExp(`^https://x\\.com/(?:[A-Za-z0-9_]+|i)/status/${tweet.id}$`),
        );
        assert.ok(tweet.text && tweet.author);
        assert.ok(Date.parse(tweet.created) >= Date.now() - 86_400_000);
        assert.ok([tweet.likes, tweet.retweets, tweet.replies].every(Number.isFinite));
      }
      assert.ok(!data.topMentions.includes("AAPL"));
    }),
    required("reddit:listing-comments", async () => {
      const data = await getSubredditPosts("stocks", 3);
      assert.ok(data.posts.length > 0);
      assert.equal(data.postCount, data.posts.length);
      assert.ok(Number.isFinite(Date.parse(data.fetchedAt)));
      for (const post of data.posts) {
        assert.ok(post.id && post.title && post.author);
        assert.match(post.url, /^https?:\/\//);
        assert.ok(Number.isFinite(Date.parse(post.created)));
      }
      cache.clear();
      const comments = await getPostComments("stocks", data.posts[0].id, 3);
      assert.ok(comments.length > 0);
      assert.ok(
        comments.every((item) => item.body && item.id && /^https?:\/\//.test(item.permalink)),
      );
    }),
    required("reddit:search", async () => {
      const data = await getSubredditPosts("stocks", 3, "Nvidia");
      assert.ok(data.posts.length > 0, "known-positive subreddit search returned no posts");
      assert.ok(data.posts.every((post) => post.id && post.title && post.url));
    }),
  ];
}
