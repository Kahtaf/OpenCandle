import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { getConfig } from "../../config.js";
import { hasCredential } from "../../onboarding/providers.js";
import { buildSoftDegradedTag } from "../../onboarding/tool-tags.js";
import { finnhubDateRange, getCompanyNews } from "../../providers/finnhub.js";
import { searchWeb } from "../../providers/web-search.js";
import { getQuote } from "../../providers/yahoo-finance.js";
import { extractTickersFromQuery, FinnhubAdapter } from "../../sentiment/adapters/finnhub.js";
import { RedditAdapter } from "../../sentiment/adapters/reddit.js";
import { TwitterAdapter } from "../../sentiment/adapters/twitter.js";
import { WebAdapter } from "../../sentiment/adapters/web.js";
import { getSentimentPipeline } from "../../sentiment/index.js";
import type { SentinelRecord } from "../../sentiment/types.js";
import type { AskUserHandler } from "../../types/index.js";
import { formatInsightSection } from "./insight-format.js";
import { createRedditSentimentTool } from "./reddit-sentiment.js";
import { createTwitterSentimentTool } from "./twitter-sentiment.js";

const params = Type.Object({
  query: Type.String({ description: "Ticker or topic for cross-source sentiment summary" }),
  hours: Type.Optional(
    Type.Number({ description: "Lookback window in hours for live fetching. Default: 24" }),
  ),
});

type ToolTextContent = { type: string; text?: string };
type SetupAwareExecute<TParams, TDetails> = (
  toolCallId: string,
  params: TParams,
  signal?: AbortSignal,
  onUpdate?: undefined,
  ctx?: ExtensionContext,
) => Promise<{ content: ToolTextContent[]; details: TDetails }>;

interface SentimentSummaryToolOptions {
  askUserHandler?: AskUserHandler;
}

export function createSentimentSummaryTool(
  options: SentimentSummaryToolOptions = {},
): AgentTool<typeof params> {
  return {
    name: "get_sentiment_summary",
    label: "Sentiment Summary",
    description:
      "Cross-source sentiment summary combining Twitter, Reddit, and web/news. Returns per-source scores, aggregate sentiment, and divergence detection.",
    parameters: params,
    async execute(_toolCallId, args, _signal, _onUpdate, ctx?: ExtensionContext) {
      const hours = args.hours ?? 24;
      const config = getConfig();
      const warnings: string[] = [];
      const allRecords: SentinelRecord[] = [];

      const twitterAdapter = new TwitterAdapter();
      const webAdapter = new WebAdapter();
      const finnhubAdapter = new FinnhubAdapter();

      // Determine if Finnhub should be included (key configured + ticker in
      // query). `candidateTickers` is extracted unconditionally so we can tell
      // a "no finnhub-mappable ticker in the query" case apart from a "query
      // has tickers but user has no Finnhub key" case — the latter warrants a
      // soft-degraded tag so the LLM surfaces it in the Data gaps section.
      const candidateTickers = extractTickersFromQuery(args.query);
      const finnhubTickers = config.finnhubApiKey ? candidateTickers : [];
      const includeFinnhub = finnhubTickers.length > 0 && Boolean(config.finnhubApiKey);
      const finnhubSoftDegraded = candidateTickers.length > 0 && !hasCredential("finnhub");

      const fetchFinnhub = async (): Promise<
        import("../../providers/finnhub.js").FinnhubArticle[]
      > => {
        if (!includeFinnhub) return [];
        const finnhubApiKey = config.finnhubApiKey;
        if (!finnhubApiKey) return [];
        const { from, to } = finnhubDateRange("day");
        const arrays = await Promise.all(
          finnhubTickers.map((sym) => getCompanyNews(sym, from, to, finnhubApiKey)),
        );
        return arrays.flat();
      };

      // External-tool sources may need ask_user setup. Run them through the
      // source-specific tools so install/login/skip preferences behave the same
      // in cross-source summaries as they do in direct source requests.
      try {
        const twitterTool = createTwitterSentimentTool({
          askUserHandler: options.askUserHandler,
        });
        const executeTwitter = twitterTool.execute as unknown as SetupAwareExecute<
          { query: string; limit: number; hours: number },
          NonNullable<Awaited<ReturnType<typeof twitterTool.execute>>["details"]> | null
        >;
        const twitterResult = await executeTwitter(
          "summary-twitter",
          { query: args.query, limit: 50, hours },
          undefined,
          undefined,
          ctx,
        );
        if (twitterResult.details) {
          allRecords.push(...twitterAdapter.mapToRecords(twitterResult.details, args.query));
        } else {
          warnings.push(sourceToolWarning("Twitter", toolText(twitterResult.content)));
        }
      } catch (err) {
        warnings.push(`Twitter: ${err instanceof Error ? err.message : String(err)}`);
      }

      try {
        const redditTool = createRedditSentimentTool({
          askUserHandler: options.askUserHandler,
        });
        const executeReddit = redditTool.execute as unknown as SetupAwareExecute<
          { query: string; subreddits: string[] },
          NonNullable<Awaited<ReturnType<typeof redditTool.execute>>["details"]> | null
        >;
        const redditResult = await executeReddit(
          "summary-reddit",
          {
            query: args.query,
            subreddits: config.sentiment?.defaultSubreddits ?? [
              "wallstreetbets",
              "stocks",
              "investing",
              "options",
            ],
          },
          undefined,
          undefined,
          ctx,
        );
        if (redditResult.details) {
          allRecords.push(
            ...(redditResult.details.records ??
              new RedditAdapter().mapPostsToRecords(redditResult.details, args.query)),
          );
        } else {
          warnings.push(sourceToolWarning("Reddit", toolText(redditResult.content)));
        }
      } catch (err) {
        warnings.push(`Reddit: ${err instanceof Error ? err.message : String(err)}`);
      }

      const [webResult, finnhubResult] = await Promise.allSettled([
        searchWeb(args.query, { freshness: "day", limit: 10, category: "news" }),
        // Finnhub — only when includeFinnhub; otherwise resolves to []
        fetchFinnhub(),
      ]);

      // Process Web
      if (webResult.status === "fulfilled" && webResult.value.status === "ok") {
        const records = webAdapter.mapToRecords(webResult.value.data, args.query);
        allRecords.push(...records);
      } else {
        const reason =
          webResult.status === "rejected"
            ? (webResult.reason?.message ?? "unknown error")
            : webResult.value.status === "unavailable"
              ? webResult.value.reason
              : "unavailable";
        warnings.push(`Web: ${reason}`);
      }

      // Process Finnhub (only when included — otherwise resolves to empty array anyway)
      if (includeFinnhub) {
        if (finnhubResult.status === "fulfilled") {
          const articles = finnhubResult.value;
          if (articles.length > 0) {
            const records = finnhubAdapter.mapToRecords(articles, args.query);
            allRecords.push(...records);
          }
        } else {
          warnings.push(`Finnhub: ${finnhubResult.reason?.message ?? "unknown error"}`);
        }
      }

      const softDegradedPrefix = finnhubSoftDegraded
        ? `${buildSoftDegradedTag({
            provider: "finnhub",
            fallback: "other-sentiment-sources",
            remediation: "run /connect news to enable Finnhub company news",
          })}\n\n`
        : "";

      if (allRecords.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: `${softDegradedPrefix}⚠ Sentiment summary unavailable for "${args.query}" — no sources returned data.\n${warnings.join("\n")}`,
            },
          ],
          details: null,
        };
      }

      const summaryWarnings = warnings.map(stripOpenCandleControlLines);

      // Score and index through pipeline
      const pipeline = getSentimentPipeline();
      const result = await pipeline.processRecords(allRecords, args.query);
      const insight =
        result.insight && summaryWarnings.length > 0
          ? {
              ...result.insight,
              caveats: [
                ...result.insight.caveats,
                ...summaryWarnings.map((warning) => `Source warning: ${warning}`),
              ],
            }
          : result.insight;

      // Group by source (exclude comments from per-source averages)
      const bySource: Record<string, { total: number; count: number }> = {};
      for (const rec of result.fresh) {
        if (rec.metadata.isComment) continue;
        if (!bySource[rec.source]) bySource[rec.source] = { total: 0, count: 0 };
        bySource[rec.source].total += rec.sentiment.score;
        bySource[rec.source].count++;
      }

      const lines: string[] = [];
      lines.push(`**Sentiment summary for "${args.query}"** (last ${hours}h):`);
      lines.push("");
      lines.push("| Source | Score | Count | Signal |");
      lines.push("|--------|-------|-------|--------|");

      let totalScore = 0;
      let totalCount = 0;
      for (const [source, stats] of Object.entries(bySource)) {
        const avg = stats.count > 0 ? stats.total / stats.count : 0;
        const label = sentimentLabel(avg);
        const sourceName =
          source === "web" ? "Web/News" : source.charAt(0).toUpperCase() + source.slice(1);
        lines.push(
          `| ${sourceName} | ${avg >= 0 ? "+" : ""}${avg.toFixed(2)} | ${stats.count} | ${label} |`,
        );
        totalScore += stats.total;
        totalCount += stats.count;
      }

      const aggregate = totalCount > 0 ? totalScore / totalCount : 0;
      lines.push("");
      lines.push(
        `**Aggregate:** ${aggregate >= 0 ? "+" : ""}${aggregate.toFixed(2)} (${sentimentLabel(aggregate)})`,
      );

      if (insight) {
        lines.push(...formatInsightSection(insight));
      }

      const priceContext = await buildPriceContext(candidateTickers[0], aggregate);
      if (priceContext) {
        lines.push("");
        lines.push(priceContext);
      } else if (candidateTickers[0]) {
        lines.push("");
        lines.push(
          `Price context: unavailable for ${candidateTickers[0]}; sentiment/price divergence could not be evaluated.`,
        );
      }

      lines.push("");
      lines.push(
        "Source-coverage risk: sentiment can be noisy and missing sources can skew the signal; treat this as supporting evidence, not a standalone buy/sell input.",
      );

      // Divergence
      if (result.divergence?.detected) {
        lines.push("");
        lines.push(result.divergence.message);
      } else if (result.divergence && !result.divergence.detected) {
        lines.push("");
        lines.push(result.divergence.message);
      }

      // Trend
      if (result.trend && result.trend.length > 0) {
        const t = result.trend[0];
        lines.push("");
        lines.push(`Trend: ${t.sparkline} ${t.direction} (${t.count} records)`);
      }

      if (summaryWarnings.length > 0) {
        lines.push("");
        lines.push(summaryWarnings.map((w) => `⚠ ${w}`).join("\n"));
      }

      const output = softDegradedPrefix + lines.join("\n");
      return { content: [{ type: "text", text: output }], details: { ...result, insight } };
    },
  };
}

export const sentimentSummaryTool = createSentimentSummaryTool();

async function buildPriceContext(
  symbol: string | undefined,
  aggregateSentiment: number,
): Promise<string | null> {
  if (!symbol) return null;
  try {
    const quote = await getQuote(symbol);
    const sign = quote.changePercent >= 0 ? "+" : "";
    const direction =
      quote.changePercent > 0 ? "positive" : quote.changePercent < 0 ? "negative" : "flat";
    const sentimentDirection =
      aggregateSentiment > 0 ? "positive" : aggregateSentiment < 0 ? "negative" : "neutral";
    const relationship =
      sentimentDirection === "neutral" || direction === "flat" || sentimentDirection === direction
        ? "roughly aligns with price action"
        : "diverges from price action";
    const freshnessNote = formatQuoteFreshnessNote(quote.timestamp);
    return `Price context: ${quote.symbol}: $${quote.price.toFixed(2)} (${sign}${quote.changePercent.toFixed(2)}%).${freshnessNote} The ${sentimentDirection} sentiment signal ${relationship}.`;
  } catch {
    return null;
  }
}

function formatQuoteFreshnessNote(timestamp: number | undefined): string {
  if (!timestamp) return "";
  const quoteDate = new Date(timestamp);
  if (Number.isNaN(quoteDate.getTime())) return "";

  const now = new Date();
  const quoteDay = quoteDate.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const currentDay = now.toLocaleDateString("en-US", { timeZone: "America/New_York" });
  const quoteStamp = quoteDate.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/New_York",
  });

  const weekday = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "America/New_York",
  }).format(now);
  const isWeekend = weekday === "Saturday" || weekday === "Sunday";

  if (quoteDay === currentDay) {
    const marketClosedNote = isWeekend
      ? " U.S. markets are closed today, so treat this as delayed or last available price context, not active intraday trading."
      : "";
    return ` Quote timestamp: ${quoteStamp} ET.${marketClosedNote}`;
  }

  const marketClosedNote = isWeekend
    ? " U.S. markets are closed today, so treat this as last trading-session price action."
    : "";

  return ` Last available quote timestamp: ${quoteStamp} ET.${marketClosedNote}`;
}

function sentimentLabel(score: number): string {
  if (score > 0.3) return "Bullish";
  if (score < -0.3) return "Bearish";
  if (score > 0) return "Leaning Bullish";
  if (score < 0) return "Leaning Bearish";
  return "Neutral";
}

function toolText(content: ToolTextContent[]): string {
  return content
    .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
    .filter(Boolean)
    .join("\n");
}

function sourceToolWarning(source: string, text: string): string {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const tag = lines.find((line) => line.includes("[OPENCANDLE_"));
  const summary = lines.find((line) => !line.includes("[OPENCANDLE_")) ?? "unavailable";
  return tag ? `${source}: ${summary}\n${tag}` : `${source}: ${summary}`;
}

function stripOpenCandleControlLines(text: string): string {
  const stripped = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("[OPENCANDLE_"))
    .join("\n");
  return stripped || "unavailable";
}
