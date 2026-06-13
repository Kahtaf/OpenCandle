import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { getConfig } from "../../config.js";
import { hasCredential } from "../../onboarding/providers.js";
import { buildSoftDegradedTag } from "../../onboarding/tool-tags.js";
import { finnhubDateRange, getCompanyNews } from "../../providers/finnhub.js";
import { getPostComments, getSubredditPosts } from "../../providers/reddit.js";
import { getTwitterSentiment } from "../../providers/twitter.js";
import { searchWeb } from "../../providers/web-search.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getQuote } from "../../providers/yahoo-finance.js";
import { extractTickersFromQuery, FinnhubAdapter } from "../../sentiment/adapters/finnhub.js";
import { RedditAdapter } from "../../sentiment/adapters/reddit.js";
import { TwitterAdapter } from "../../sentiment/adapters/twitter.js";
import { WebAdapter } from "../../sentiment/adapters/web.js";
import { getSentimentPipeline } from "../../sentiment/index.js";
import type { SentinelRecord } from "../../sentiment/types.js";

const params = Type.Object({
  query: Type.String({ description: "Ticker or topic for cross-source sentiment summary" }),
  hours: Type.Optional(
    Type.Number({ description: "Lookback window in hours for live fetching. Default: 24" }),
  ),
});

export const sentimentSummaryTool: AgentTool<typeof params> = {
  name: "get_sentiment_summary",
  label: "Sentiment Summary",
  description:
    "Cross-source sentiment summary combining Twitter, Reddit, and web/news. Returns per-source scores, aggregate sentiment, and divergence detection.",
  parameters: params,
  async execute(_toolCallId, args) {
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

    // Finnhub fetch (built separately to avoid mixing promise types in allSettled)
    const finnhubFetch: Promise<import("../../providers/finnhub.js").FinnhubArticle[]> =
      includeFinnhub
        ? (async () => {
            const { from, to } = finnhubDateRange("day");
            const arrays = await Promise.all(
              finnhubTickers.map((sym) => getCompanyNews(sym, from, to, config.finnhubApiKey!)),
            );
            return arrays.flat();
          })()
        : Promise.resolve([]);

    // Fetch all sources in parallel
    const [twitterResult, redditResults, webResult, finnhubResult] = await Promise.allSettled([
      // Twitter
      wrapProvider("twitter", () => getTwitterSentiment(args.query, 50, hours)),
      // Reddit — cross-subreddit
      fetchRedditCrossSubreddit(
        args.query,
        config.sentiment?.defaultSubreddits ?? ["wallstreetbets", "stocks", "investing", "options"],
      ),
      // Web
      searchWeb(args.query, { freshness: "day", limit: 10, category: "news" }),
      // Finnhub — only when includeFinnhub; otherwise resolves to []
      finnhubFetch,
    ]);

    // Process Twitter
    if (twitterResult.status === "fulfilled" && twitterResult.value.status === "ok") {
      const records = twitterAdapter.mapToRecords(twitterResult.value.data, args.query);
      allRecords.push(...records);
    } else {
      const reason =
        twitterResult.status === "rejected"
          ? (twitterResult.reason?.message ?? "unknown error")
          : ((twitterResult.value as any).reason ?? "unavailable");
      warnings.push(`Twitter: ${reason}`);
    }

    // Process Reddit
    if (redditResults.status === "fulfilled") {
      const { records: redditRecords, warnings: redditWarnings } = redditResults.value;
      allRecords.push(...redditRecords);
      warnings.push(...redditWarnings);
    } else {
      warnings.push(`Reddit: ${redditResults.reason?.message ?? "unknown error"}`);
    }

    // Process Web
    if (webResult.status === "fulfilled" && webResult.value.status === "ok") {
      const records = webAdapter.mapToRecords(webResult.value.data, args.query);
      allRecords.push(...records);
    } else {
      const reason =
        webResult.status === "rejected"
          ? (webResult.reason?.message ?? "unknown error")
          : ((webResult.value as any).reason ?? "unavailable");
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
        details: null as any,
      };
    }

    // Score and index through pipeline
    const pipeline = getSentimentPipeline();
    const result = await pipeline.processRecords(allRecords, args.query);

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

    const priceContext = await buildPriceContext(candidateTickers[0], aggregate);
    if (priceContext) {
      lines.push("");
      lines.push(priceContext);
    }

    lines.push("");
    lines.push(
      "Source-coverage risk: sentiment can be noisy and missing sources can skew the signal; treat this as supporting evidence, not a standalone buy/sell input.",
    );

    // Divergence
    if (result.divergence && result.divergence.detected) {
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

    if (warnings.length > 0) {
      lines.push("");
      lines.push(warnings.map((w) => `⚠ ${w}`).join("\n"));
    }

    const output = softDegradedPrefix + lines.join("\n");
    return { content: [{ type: "text", text: output }], details: result };
  },
};

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

async function fetchRedditCrossSubreddit(
  query: string,
  subreddits: string[],
): Promise<{ records: SentinelRecord[]; warnings: string[] }> {
  const adapter = new RedditAdapter();
  const records: SentinelRecord[] = [];
  const warnings: string[] = [];
  const config = getConfig();
  const commentsPerPost = config.sentiment?.commentsPerPost ?? 5;

  for (const sub of subreddits) {
    const result = await wrapProvider("reddit", () => getSubredditPosts(sub, 25));
    if (result.status === "unavailable") {
      warnings.push(`Reddit r/${sub}: ${result.reason}`);
      continue;
    }
    const postRecords = adapter.mapPostsToRecords(result.data, query);

    // Topic filter
    const queryLower = query.toLowerCase();
    const filtered = postRecords.filter(
      (r) =>
        r.text.toLowerCase().includes(queryLower) ||
        (r.title?.toLowerCase().includes(queryLower) ?? false),
    );
    records.push(...filtered);

    // Fetch comments for top posts
    const topPosts = [...filtered]
      .sort((a, b) => b.engagement.score - a.engagement.score)
      .slice(0, 3); // fewer per sub since we're searching multiple
    for (const post of topPosts) {
      if ((post.engagement.replies ?? 0) === 0) continue;
      try {
        const comments = await getPostComments(sub, post.sourceId, commentsPerPost);
        records.push(...adapter.mapCommentsToRecords(comments, post.sourceId, sub, query));
      } catch {
        /* non-fatal */
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped = records.filter((r) => {
    if (seen.has(r.sourceId)) return false;
    seen.add(r.sourceId);
    return true;
  });

  return { records: deduped, warnings };
}

function sentimentLabel(score: number): string {
  if (score > 0.3) return "Bullish";
  if (score < -0.3) return "Bearish";
  if (score > 0) return "Leaning Bullish";
  if (score < 0) return "Leaning Bearish";
  return "Neutral";
}
