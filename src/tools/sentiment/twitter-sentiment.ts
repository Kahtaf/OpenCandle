import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { getTwitterSentiment } from "../../providers/twitter.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import type { TwitterSentimentResult } from "../../types/sentiment.js";

const params = Type.Object({
  query: Type.String({
    description: "Stock ticker (e.g. AAPL) or search term (e.g. 'AAPL earnings call')",
  }),
  limit: Type.Optional(
    Type.Number({ description: "Max tweets to fetch. Default: 50, max: 200" }),
  ),
  hours: Type.Optional(
    Type.Number({ description: "Lookback window in hours. Default: 24" }),
  ),
});

export const twitterSentimentTool: AgentTool<typeof params, TwitterSentimentResult> = {
  name: "get_twitter_sentiment",
  label: "Twitter Sentiment",
  description:
    "Fetch recent tweets for a stock ticker or search query and compute engagement-weighted sentiment. Returns tweet data, sentiment score, and co-mentioned tickers. Requires a Twitter session via trigger_twitter_login.",
  parameters: params,
  async execute(toolCallId, args) {
    const limit = Math.min(args.limit ?? 50, 200);
    const hours = args.hours ?? 24;

    const providerResult = await wrapProvider("twitter", () =>
      getTwitterSentiment(args.query, limit, hours),
    );

    if (providerResult.status === "unavailable") {
      const isLoginIssue =
        providerResult.reason.includes("No Twitter session") ||
        providerResult.reason.includes("session expired");
      const text = isLoginIssue
        ? `⚠ Twitter sentiment unavailable: ${providerResult.reason}\n[LOGIN_NEEDED] Use ask_user to confirm, then call trigger_twitter_login. After success, retry this tool.`
        : `⚠ Twitter sentiment unavailable (${providerResult.reason}).`;
      return {
        content: [{ type: "text", text }],
        details: null as any,
      };
    }

    const result = providerResult.data;

    const sentimentLabel =
      result.sentimentScore > 0.3 ? "Bullish" :
      result.sentimentScore < -0.3 ? "Bearish" :
      result.sentimentScore > 0 ? "Leaning Bullish" :
      result.sentimentScore < 0 ? "Leaning Bearish" : "Neutral";

    const lines = [
      `**Twitter: ${result.query}** — ${result.tweetCount} tweets (last ${hours}h, ${result.fetchedAt})`,
      `Sentiment: ${result.sentimentScore.toFixed(2)} (${sentimentLabel}) | Bullish: ${result.bullishCount} | Bearish: ${result.bearishCount}`,
    ];

    if (result.topMentions.length > 0) {
      lines.push(`Co-mentions: ${result.topMentions.map((t) => `$${t}`).join(", ")}`);
    }

    lines.push("");
    lines.push("| Author | Tweet | ❤️ | 🔁 | 💬 |");
    lines.push("|--------|-------|----|----|----|");
    const top = result.tweets.slice(0, 15);
    for (const tweet of top) {
      const text = tweet.text.replace(/\|/g, "\\|").replace(/\n/g, " ").slice(0, 100);
      lines.push(`| @${tweet.author} | ${text} | ${tweet.likes} | ${tweet.retweets} | ${tweet.replies} |`);
    }

    if (providerResult.stale) {
      lines.push("");
      lines.push(`⚠ Stale data (cached at ${providerResult.timestamp})`);
    }

    return { content: [{ type: "text", text: lines.join("\n") }], details: result };
  },
};
