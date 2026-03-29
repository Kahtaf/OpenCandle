import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getSubredditPosts } from "../../providers/reddit.js";
import type { RedditSentimentResult } from "../../types/sentiment.js";

const params = Type.Object({
  topic: Type.String({
    description: "Topic or ticker to search for news sentiment (e.g. AAPL, bitcoin, inflation)",
  }),
});

export const newsSentimentTool: AgentTool<typeof params, RedditSentimentResult> = {
  name: "get_reddit_discussions",
  label: "Reddit Financial Discussions",
  description:
    "Search financial Reddit communities (r/stocks, r/investing) for recent discussions about a topic. Useful for gauging retail sentiment, but not a substitute for news or institutional analysis.",
  parameters: params,
  async execute(toolCallId, args) {
    // Use r/stocks and r/investing as news proxies
    const subreddits = ["stocks", "investing"];
    const allPosts: RedditSentimentResult["posts"] = [];
    const allMentions: string[] = [];

    for (const sub of subreddits) {
      try {
        const result = await getSubredditPosts(sub, 25);
        // Filter posts that mention the topic
        const relevant = result.posts.filter(
          (p) => p.title.toLowerCase().includes(args.topic.toLowerCase()),
        );
        allPosts.push(...relevant);
        allMentions.push(...result.topMentions);
      } catch {
        // Continue with other subreddits if one fails
      }
    }

    const uniqueMentions = [...new Set(allMentions)];
    const text = [
      `**Reddit Discussions for "${args.topic}"** — ${allPosts.length} relevant posts found`,
      uniqueMentions.length > 0
        ? `Related tickers: ${uniqueMentions.map((t) => `$${t}`).join(", ")}`
        : "",
      "",
      ...allPosts.slice(0, 10).map(
        (p) => `  ⬆${p.score} 💬${p.comments} — ${p.title.slice(0, 100)}`,
      ),
      allPosts.length === 0 ? "No relevant discussions found. Try broader search terms." : "",
    ]
      .filter(Boolean)
      .join("\n");

    return {
      content: [{ type: "text", text }],
      details: {
        subreddit: "stocks+investing",
        postCount: allPosts.length,
        posts: allPosts,
        topMentions: uniqueMentions,
        sentimentScore: 0,
        bullishCount: 0,
        bearishCount: 0,
        fetchedAt: new Date().toISOString(),
      },
    };
  },
};
