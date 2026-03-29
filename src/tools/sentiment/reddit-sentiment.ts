import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getSubredditPosts } from "../../providers/reddit.js";
import type { RedditSentimentResult } from "../../types/sentiment.js";

const params = Type.Object({
  subreddit: Type.String({
    description:
      "Subreddit name (e.g. wallstreetbets, stocks, investing, cryptocurrency, options)",
  }),
  limit: Type.Optional(
    Type.Number({ description: "Number of posts to fetch. Default: 25, max: 100" }),
  ),
});

export const redditSentimentTool: AgentTool<typeof params, RedditSentimentResult> = {
  name: "get_reddit_sentiment",
  label: "Reddit Sentiment",
  description:
    "Get hot posts from a finance subreddit for sentiment analysis. Returns post titles, scores, comment counts, and detected ticker mentions. Use for retail sentiment.",
  parameters: params,
  async execute(toolCallId, args) {
    const limit = Math.min(args.limit ?? 25, 100);
    const result = await getSubredditPosts(args.subreddit, limit);

    const lines = [
      `**r/${result.subreddit}** — ${result.postCount} hot posts (${result.fetchedAt})`,
    ];

    if (result.topMentions.length > 0) {
      lines.push(`Ticker mentions: ${result.topMentions.map((t) => `$${t}`).join(", ")}`);
    }

    lines.push("");
    lines.push("Top posts:");
    const top = result.posts.slice(0, 10);
    for (const post of top) {
      lines.push(
        `  ⬆${post.score} 💬${post.comments} — ${post.title.slice(0, 100)}`,
      );
    }

    return { content: [{ type: "text", text: lines.join("\n") }], details: result };
  },
};
