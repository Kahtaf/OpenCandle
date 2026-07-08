import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { searchWeb } from "../../providers/web-search.js";
import { WebAdapter } from "../../sentiment/adapters/web.js";
import { getSentimentPipeline } from "../../sentiment/index.js";
import { formatInsightSection } from "./insight-format.js";
import { renderUntrustedText, untrustedContentHeader } from "./untrusted-text.js";

const params = Type.Object({
  query: Type.String({ description: "Ticker or topic to search for web/news sentiment" }),
  freshness: Type.Optional(
    Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month")], {
      description: "Time window for results. Default: day",
    }),
  ),
  limit: Type.Optional(Type.Number({ description: "Max results. Default: 10, max: 20" })),
});

export const webSentimentTool: AgentTool<typeof params> = {
  name: "get_web_sentiment",
  label: "Web/News Sentiment",
  description:
    "Analyze sentiment from web and news search results for a ticker or topic. Returns scored results with aggregate sentiment.",
  parameters: params,
  async execute(_toolCallId, args) {
    const freshness = args.freshness ?? "day";
    const limit = Math.min(args.limit ?? 10, 20);

    const providerResult = await searchWeb(args.query, { freshness, limit, category: "news" });

    if (providerResult.status === "unavailable") {
      return {
        content: [
          {
            type: "text",
            text: `⚠ Web sentiment unavailable for "${args.query}" (${providerResult.reason}).`,
          },
        ],
        details: null,
      };
    }

    const adapter = new WebAdapter();
    const records = adapter.mapToRecords(providerResult.data, args.query);
    const pipeline = getSentimentPipeline();
    const result = await pipeline.processRecords(records, args.query);

    const lines: string[] = [];
    if (result.fresh.length === 0) {
      lines.push(`No web results found for "${args.query}".`);
    } else {
      const avgScore =
        result.fresh.reduce((s, r) => s + r.sentiment.score, 0) / result.fresh.length;
      const label = sentimentLabel(avgScore);
      lines.push(
        `**Web sentiment for "${args.query}"** — ${result.fresh.length} results (${label}, ${avgScore.toFixed(2)})`,
      );
      if (result.insight) {
        lines.push(...formatInsightSection(result.insight));
      }
      lines.push("");
      lines.push(untrustedContentHeader("web sentiment results"));

      for (const rec of result.fresh.slice(0, limit)) {
        const indicator = rec.sentiment.score > 0 ? "🟢" : rec.sentiment.score < 0 ? "🔴" : "⚪";
        const title = renderUntrustedText(rec.title ?? rec.text, 150);
        const titleText = isHttpUrl(rec.url) ? `[${title}](${rec.url})` : title;
        lines.push(`${indicator} ${titleText} — *${rec.author}*`);
        lines.push(`  ${renderUntrustedText(rec.text, 150)}`);
        lines.push(
          `  Score: ${rec.sentiment.score.toFixed(2)} | Confidence: ${rec.sentiment.confidence.toFixed(2)}`,
        );
      }

      if (result.trend) {
        lines.push("");
        const t = result.trend[0];
        lines.push(`Trend: ${t.sparkline} ${t.direction} (${t.count} records)`);
      }
    }

    return { content: [{ type: "text", text: lines.join("\n") }], details: result };
  },
};

function sentimentLabel(score: number): string {
  if (score > 0.3) return "Bullish";
  if (score < -0.3) return "Bearish";
  if (score > 0) return "Leaning Bullish";
  if (score < 0) return "Leaning Bearish";
  return "Neutral";
}

function isHttpUrl(url: string | null): url is string {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}
