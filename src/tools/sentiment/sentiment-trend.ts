import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { SentimentStore } from "../../sentiment/store.js";
import { getSentimentStore } from "../../sentiment/index.js";
import { computeTrend } from "../../sentiment/trends.js";

const params = Type.Object({
  query: Type.String({ description: "Ticker or topic to look up sentiment history" }),
  days: Type.Optional(
    Type.Number({ description: "Number of days of history. Default: 7, max: 30" }),
  ),
  source: Type.Optional(
    Type.Union([Type.Literal("twitter"), Type.Literal("reddit"), Type.Literal("web")], {
      description: "Filter to a single source. Default: all sources.",
    }),
  ),
});

interface TrendToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: any;
}

export const sentimentTrendTool: AgentTool<typeof params> & {
  executeWithStore: (toolCallId: string, args: { query: string; days?: number; source?: string }, store: SentimentStore) => Promise<TrendToolResult>;
} = {
  name: "get_sentiment_trend",
  label: "Sentiment Trend",
  description:
    "Query historical sentiment data from the local store. No live API calls — returns trends from previously fetched data. Run a sentiment query first to populate the store.",
  parameters: params,
  async execute(toolCallId, args) {
    const store = getSentimentStore();
    return sentimentTrendTool.executeWithStore(toolCallId, args, store);
  },
  async executeWithStore(_toolCallId, args, store) {
    const days = Math.min(args.days ?? 7, 30);
    const series = store.getTimeSeries(args.query, { days, bucketHours: 24 });

    if (series.length === 0) {
      return {
        content: [{ type: "text", text: `No historical sentiment data for "${args.query}". Run a sentiment query first to populate the store.` }],
        details: null,
      };
    }

    const trend = computeTrend(series, (args.source as any) ?? "aggregate");

    const lines = [
      `**Sentiment trend for "${args.query}"** (${days}d):`,
      "",
      `${trend.sparkline}  ${trend.direction} (${trend.delta >= 0 ? "+" : ""}${trend.delta.toFixed(2)})`,
      `Avg: ${trend.avgScore.toFixed(2)} | Records: ${trend.count}`,
    ];

    return { content: [{ type: "text", text: lines.join("\n") }], details: { trend, series } };
  },
};
