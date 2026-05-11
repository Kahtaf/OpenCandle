import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getSubredditPosts, getPostComments } from "../../providers/reddit.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { RedditSentimentResult } from "../../types/sentiment.js";
import { RedditAdapter } from "../../sentiment/adapters/reddit.js";
import { getSentimentPipeline } from "../../sentiment/index.js";
import { getConfig } from "../../config.js";

const params = Type.Object({
  subreddit: Type.Optional(
    Type.String({
      description:
        "Subreddit name (e.g. wallstreetbets, stocks). If omitted, searches across default subreddits.",
    }),
  ),
  query: Type.Optional(
    Type.String({
      description:
        "Topic or ticker to filter posts by (e.g. AAPL, bitcoin). Searches titles and post bodies.",
    }),
  ),
  subreddits: Type.Optional(
    Type.Array(Type.String(), {
      description: "Multiple subreddits to search. Overrides single subreddit param.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Number of posts per subreddit. Default: 25, max: 100" }),
  ),
});

export const redditSentimentTool: AgentTool<typeof params, RedditSentimentResult> = {
  name: "get_reddit_sentiment",
  label: "Reddit Sentiment",
  description:
    "Analyze sentiment from financial Reddit communities. Supports single subreddit, multi-subreddit, and topic filtering. Returns scored posts with comment analysis and trend context.",
  parameters: params,
  async execute(toolCallId, args) {
    const limit = Math.min(args.limit ?? 25, 100);
    const config = getConfig();

    // Determine subreddits to search
    let subreddits: string[];
    if (args.subreddits && args.subreddits.length > 0) {
      subreddits = args.subreddits;
    } else if (args.subreddit) {
      subreddits = [args.subreddit];
    } else {
      subreddits = config.sentiment?.defaultSubreddits ?? ["wallstreetbets", "stocks", "investing", "options"];
    }

    // Fetch from all subreddits
    const allResults: RedditSentimentResult[] = [];
    const warnings: string[] = [];
    for (const sub of subreddits) {
      const providerResult = await wrapProvider("reddit", () => getSubredditPosts(sub, limit));
      if (providerResult.status === "unavailable") {
        warnings.push(`r/${sub}: ${providerResult.reason}`);
        continue;
      }
      allResults.push(providerResult.data);
    }

    if (allResults.length === 0) {
      return {
        content: [{ type: "text", text: `⚠ Reddit sentiment unavailable (${warnings.join("; ")}).` }],
        details: null as any,
      };
    }

    // Merge and filter by query if provided
    const adapter = new RedditAdapter();
    let allRecords = allResults.flatMap((r) => adapter.mapPostsToRecords(r, args.query ?? subreddits.join("+")));

    // Topic filtering
    if (args.query) {
      const queryLower = args.query.toLowerCase();
      allRecords = allRecords.filter((r) =>
        r.text.toLowerCase().includes(queryLower) ||
        (r.title?.toLowerCase().includes(queryLower) ?? false),
      );
    }

    // Deduplicate by sourceId (crossposts)
    const seen = new Set<string>();
    allRecords = allRecords.filter((r) => {
      if (seen.has(r.sourceId)) return false;
      seen.add(r.sourceId);
      return true;
    });

    // Fetch comments for top 10 posts by engagement
    const commentsPerPost = config.sentiment?.commentsPerPost ?? 5;
    const topPosts = [...allRecords]
      .sort((a, b) => b.engagement.score - a.engagement.score)
      .slice(0, 10);

    for (const post of topPosts) {
      const sub = (post.metadata.subreddit as string) ?? subreddits[0];
      if ((post.engagement.replies ?? 0) === 0) continue;
      try {
        const comments = await getPostComments(sub, post.sourceId, commentsPerPost);
        const commentRecords = adapter.mapCommentsToRecords(
          comments,
          post.sourceId,
          sub,
          args.query ?? subreddits.join("+"),
        );
        allRecords.push(...commentRecords);
      } catch {
        // Comment fetch failures are non-fatal
      }
    }

    // Process through pipeline
    const pipeline = getSentimentPipeline();
    const pipelineResult = await pipeline.processRecords(allRecords, args.query ?? subreddits.join("+"));

    // Build output using first result as base for backward compatibility
    const firstResult = allResults[0];
    const postRecords = pipelineResult.fresh.filter((r) => !r.metadata.isComment);
    const commentRecords = pipelineResult.fresh.filter((r) => r.metadata.isComment);
    const avgScore = postRecords.length > 0
      ? postRecords.reduce((s, r) => s + r.sentiment.score, 0) / postRecords.length
      : 0;

    const sentimentLabel =
      avgScore > 0.3 ? "Bullish" :
      avgScore < -0.3 ? "Bearish" :
      avgScore > 0 ? "Leaning Bullish" :
      avgScore < 0 ? "Leaning Bearish" : "Neutral";

    const subLabel = subreddits.length === 1 ? `r/${subreddits[0]}` : `${subreddits.length} subreddits`;
    const lines = [
      `**Reddit: ${args.query ?? subLabel}** — ${postRecords.length} posts, ${commentRecords.length} comments`,
      `Sentiment: ${avgScore.toFixed(2)} (${sentimentLabel})`,
    ];

    if (firstResult.topMentions.length > 0) {
      lines.push(`Tickers: ${firstResult.topMentions.map((t) => `$${t}`).join(", ")}`);
    }

    lines.push("");
    lines.push("Top posts:");
    for (const post of postRecords.slice(0, 10)) {
      const scoreIndicator = post.sentiment.score > 0 ? "🟢" : post.sentiment.score < 0 ? "🔴" : "⚪";
      lines.push(`  ${scoreIndicator} ⬆${post.engagement.score} 💬${post.engagement.replies ?? 0} — ${(post.title ?? post.text).slice(0, 100)}`);
    }

    if (pipelineResult.trend && pipelineResult.trend.length > 0) {
      const t = pipelineResult.trend[0];
      lines.push("");
      lines.push(`Trend: ${t.sparkline} ${t.direction} (${t.delta >= 0 ? "+" : ""}${t.delta.toFixed(2)}, ${t.count} records)`);
    }

    if (warnings.length > 0) {
      lines.push("");
      lines.push(`⚠ ${warnings.join("; ")}`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }], details: firstResult };
  },
};
