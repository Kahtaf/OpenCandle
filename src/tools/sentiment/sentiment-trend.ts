import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { getSentimentStore } from "../../sentiment/index.js";
import type { SentimentStore } from "../../sentiment/store.js";
import { computeTrend } from "../../sentiment/trends.js";
import type { SentimentSource, TrendBucket, TrendResult } from "../../sentiment/types.js";
import { SENTIMENT_SOURCES } from "../../sentiment/types.js";

const params = Type.Object({
  query: Type.String({ description: "Ticker or topic to look up sentiment history" }),
  days: Type.Optional(
    Type.Number({ description: "Number of days of history. Default: 7, max: 30" }),
  ),
  source: Type.Optional(
    Type.Union(
      [
        Type.Literal("twitter"),
        Type.Literal("reddit"),
        Type.Literal("web"),
        Type.Literal("finnhub"),
      ],
      {
        description: "Filter to a single source. Default: all sources.",
      },
    ),
  ),
});

interface TrendToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: { trend: TrendResult; series: TrendBucket[] } | null;
}

export const sentimentTrendTool: AgentTool<typeof params> & {
  executeWithStore: (
    toolCallId: string,
    args: { query: string; days?: number; source?: string },
    store: SentimentStore,
  ) => Promise<TrendToolResult>;
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
        content: [
          {
            type: "text",
            text: `No historical sentiment data for "${args.query}". Run a sentiment query first to populate the store.`,
          },
        ],
        details: null,
      };
    }

    const source = isSentimentTrendSource(args.source) ? args.source : "aggregate";
    const trend = computeTrend(series, source);

    const lines = [
      `**Sentiment trend for "${args.query}"** (${days}d):`,
      "",
      `${trend.sparkline}  ${trend.direction} (${trend.delta >= 0 ? "+" : ""}${trend.delta.toFixed(2)})`,
      `Avg: ${trend.avgScore.toFixed(2)} | Records: ${trend.count}`,
    ];

    return { content: [{ type: "text", text: lines.join("\n") }], details: { trend, series } };
  },
};

function isSentimentTrendSource(source: string | undefined): source is SentimentSource {
  return source !== undefined && SENTIMENT_SOURCES.includes(source as SentimentSource);
}
