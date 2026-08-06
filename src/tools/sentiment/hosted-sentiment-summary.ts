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
export function createHostedSentimentSummaryTool(
  allowedProviders?: readonly ("ddg" | "exa" | "brave")[],
  allowedEvidenceProviders?: readonly ("yahoo" | "finnhub")[],
): AgentTool<typeof params> & {
  __hostedAllowedProviders?: readonly string[];
  __hostedEvidenceProviders?: readonly string[];
} {
  return {
    name: "get_sentiment_summary",
    label: "Sentiment Evidence",
    description:
      "Collect web/news evidence, optional Finnhub company news, and current price context for a ticker or market topic. Hosted mode excludes X and Reddit.",
    parameters: params,
    ...(allowedProviders ? { __hostedAllowedProviders: [...allowedProviders] } : {}),
    ...(allowedEvidenceProviders
      ? { __hostedEvidenceProviders: [...allowedEvidenceProviders] }
      : {}),
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
          allowedProviders,
        }),
        (allowedEvidenceProviders == null || allowedEvidenceProviders.includes("finnhub")) &&
        config.finnhubApiKey &&
        tickers.length > 0
          ? collectFinnhubCompanyNews(tickers, from, to, config.finnhubApiKey)
          : Promise.resolve({ articles: [], failedSymbols: [] }),
        tickers[0] &&
        (allowedEvidenceProviders == null || allowedEvidenceProviders.includes("yahoo"))
          ? wrapProvider("yahoo", () => getQuote(tickers[0]))
          : Promise.resolve(undefined),
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
      const finnhubArticles = finnhub.status === "fulfilled" ? finnhub.value.articles : [];
      const finnhubEvidence =
        finnhubArticles.length > 0
          ? {
              freshness: "unknown" as const,
              results: finnhubArticles.map((item) => ({
                id: item.id,
                headline: item.headline,
                url: item.url,
                publishedAt: finnhubPublishedAt(item.datetime),
              })),
            }
          : null;
      const evidenceHeading = webEvidence?.stale
        ? "Cached evidence"
        : webEvidence && !finnhubEvidence
          ? "Recent evidence"
          : "Evidence";

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
        for (const item of finnhubArticles) {
          lines.push(
            `${renderNewsItem(item.headline, item.url, item.summary, finnhubPublishedAt(item.datetime))} (Finnhub)`,
          );
        }
        for (const symbol of finnhub.value.failedSymbols) {
          warnings.push(`Finnhub company news was unavailable for ${symbol}.`);
        }
        if (finnhubEvidence) {
          warnings.push(
            "Finnhub freshness is unknown; use the publication timestamps shown for each article.",
          );
        }
      } else {
        warnings.push("Finnhub company news was unavailable.");
      }

      const validPriceResult =
        quote.status === "fulfilled" &&
        quote.value?.status === "ok" &&
        Number.isFinite(quote.value.data.price) &&
        Number.isFinite(quote.value.data.changePercent) &&
        !isZeroFilledQuote(quote.value.data)
          ? quote.value
          : undefined;
      if (validPriceResult) {
        const value = validPriceResult.data;
        const label = validPriceResult.stale ? "Cached price context" : "Price context";
        const symbol = renderUntrustedText(value.symbol, 40);
        const currency = renderUntrustedText(value.currency ?? "", 16);
        lines.push(
          "",
          `${label} (Yahoo Finance, as of ${validPriceResult.timestamp}): ${symbol} ${value.price.toFixed(2)} ${currency}; day change ${value.changePercent >= 0 ? "+" : ""}${value.changePercent.toFixed(2)}%.`,
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
          finnhubEvidence,
          sources: {
            web: web.status === "fulfilled" && web.value.status === "ok",
            finnhub: finnhub.status === "fulfilled" && finnhubArticles.length > 0,
            price: Boolean(validPriceResult),
          },
        },
      };
    },
  };
}

export const hostedSentimentSummaryTool = createHostedSentimentSummaryTool();

async function collectFinnhubCompanyNews(
  tickers: string[],
  from: string,
  to: string,
  apiKey: string,
) {
  const settled = await Promise.allSettled(
    tickers.map((symbol) => getCompanyNews(symbol, from, to, apiKey)),
  );
  const groups: Array<Awaited<ReturnType<typeof getCompanyNews>>> = [];
  const failedSymbols: string[] = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") groups.push(outcome.value);
    else failedSymbols.push(tickers[index]);
  }
  return { articles: roundRobin(groups, 10), failedSymbols };
}

function roundRobin<T>(groups: T[][], limit: number): T[] {
  const values: T[] = [];
  for (let index = 0; values.length < limit; index += 1) {
    let found = false;
    for (const group of groups) {
      if (index >= group.length) continue;
      values.push(group[index]);
      found = true;
      if (values.length === limit) break;
    }
    if (!found) break;
  }
  return values;
}

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

function finnhubPublishedAt(datetime: number): string | null {
  if (!Number.isFinite(datetime) || datetime <= 0) return null;
  const date = new Date(datetime * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
