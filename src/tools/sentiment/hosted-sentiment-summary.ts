import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { getConfig } from "../../config.js";
import { isZeroFilledQuote } from "../../market-state/resolve.js";
import { finnhubDateRange, getCompanyNews } from "../../providers/finnhub.js";
import { searchWeb } from "../../providers/web-search.js";
import { wrapProvider } from "../../providers/wrap-provider.js";
import { getQuote } from "../../providers/yahoo-finance.js";
import { extractTickersFromQuery } from "../../sentiment/adapters/finnhub.js";
import {
  renderUntrustedText,
  renderUntrustedUrl,
  untrustedContentHeader,
} from "./untrusted-text.js";

const params = Type.Object({
  query: Type.String({ description: "Ticker or topic for a web and company-news summary" }),
  hours: Type.Optional(
    Type.Number({ description: "Lookback window in hours. Default: 24", minimum: 1, maximum: 168 }),
  ),
});

/**
 * Hosted sentiment evidence composition.
 *
 * It intentionally omits the native X and Reddit adapters. The model, rather
 * than this tool, interprets the collected evidence as bullish or bearish.
 */
export const hostedSentimentSummaryTool: AgentTool<typeof params> = {
  name: "get_sentiment_summary",
  label: "Sentiment Evidence",
  description:
    "Collect recent web/news evidence, optional Finnhub company news, and current price context for a ticker or market topic. Hosted mode excludes X and Reddit.",
  parameters: params,
  async execute(_toolCallId, args) {
    const hours = args.hours ?? 24;
    const providerWindow = hours <= 24 ? "day" : "week";
    const config = getConfig();
    const tickers = extractTickersFromQuery(args.query).slice(0, 3);
    const warnings: string[] = [];
    const { from, to } = finnhubDateRange(providerWindow);

    const [web, finnhub, quote] = await Promise.allSettled([
      searchWeb(args.query, {
        freshness: providerWindow,
        limit: 10,
        category: "news",
      }),
      config.finnhubApiKey && tickers.length > 0
        ? Promise.all(
            tickers.map((symbol) =>
              getCompanyNews(symbol, from, to, config.finnhubApiKey as string),
            ),
          ).then((groups) => groups.flat())
        : Promise.resolve([]),
      tickers[0] ? wrapProvider("yahoo", () => getQuote(tickers[0])) : Promise.resolve(undefined),
    ]);

    const webEvidence =
      web.status === "fulfilled" && web.value.status === "ok"
        ? {
            provider: web.value.provider ?? web.value.data.provider,
            timestamp: web.value.timestamp,
            stale: web.value.stale === true,
            fetchedAt: web.value.data.fetchedAt,
            results: web.value.data.results,
          }
        : null;
    const evidenceHeading = webEvidence?.stale ? "Cached evidence" : "Recent evidence";

    const lines = [
      `**${evidenceHeading} for "${renderUntrustedText(args.query, 160)}"** (provider window: past ${providerWindow})`,
      "",
      untrustedContentHeader("Hosted web and company-news results"),
    ];

    if (web.status === "fulfilled" && web.value.status === "ok") {
      for (const item of web.value.data.results.slice(0, 10)) {
        lines.push(renderNewsItem(item.title, item.url, item.snippet, item.published));
      }
      if (web.value.stale) {
        warnings.push(`Web/news evidence came from stale cache as of ${web.value.timestamp}.`);
      }
    } else {
      warnings.push("Web/news search was unavailable.");
    }

    if (finnhub.status === "fulfilled") {
      for (const item of finnhub.value.slice(0, 10)) {
        lines.push(`${renderNewsItem(item.headline, item.url, item.summary)} (Finnhub)`);
      }
    } else {
      warnings.push("Finnhub company news was unavailable.");
    }

    if (
      quote.status === "fulfilled" &&
      quote.value?.status === "ok" &&
      Number.isFinite(quote.value.data.price) &&
      Number.isFinite(quote.value.data.changePercent) &&
      !isZeroFilledQuote(quote.value.data)
    ) {
      const value = quote.value.data;
      const label = quote.value.stale ? "Cached price context" : "Price context";
      lines.push(
        "",
        `${label} (Yahoo Finance, as of ${quote.value.timestamp}): ${value.symbol} ${value.price.toFixed(2)} ${value.currency ?? ""}; day change ${value.changePercent >= 0 ? "+" : ""}${value.changePercent.toFixed(2)}%.`,
      );
    } else if (tickers[0]) {
      warnings.push(`Price context was unavailable for ${tickers[0]}.`);
    }

    lines.push(
      "",
      "Coverage note: hosted mode uses web/news and optional Finnhub. X and Reddit require the local OpenCandle app.",
    );
    if (warnings.length > 0) lines.push(...warnings.map((warning) => `Warning: ${warning}`));
    return {
      content: [{ type: "text", text: lines.join("\n") }],
      details: {
        query: args.query,
        hours,
        tickers,
        warnings,
        webEvidence,
        sources: {
          web: web.status === "fulfilled" && web.value.status === "ok",
          finnhub: finnhub.status === "fulfilled" && finnhub.value.length > 0,
          price: quote.status === "fulfilled" && quote.value?.status === "ok",
        },
      },
    };
  },
};

function renderNewsItem(
  title: string,
  rawUrl: string,
  snippet: string,
  published?: string | null,
): string {
  const renderedTitle = renderUntrustedText(title, 180);
  const renderedSnippet = renderUntrustedText(snippet, 260);
  const url = renderUntrustedUrl(rawUrl);
  const publishedSuffix = published ? ` Published: ${renderPublishedDate(published)}` : "";
  return url
    ? `- [${renderedTitle}](${url}) — ${renderedSnippet}${publishedSuffix}`
    : `- ${renderedTitle} — ${renderedSnippet}${publishedSuffix}`;
}

function renderPublishedDate(raw: string): string {
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : renderUntrustedText(raw, 80);
}
