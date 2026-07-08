import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@sinclair/typebox";
import { httpGet, httpPost } from "../../infra/http-client.js";
import { rateLimiter } from "../../infra/rate-limiter.js";

const params = Type.Object({
  query: Type.String({
    description:
      "Search query — company name, ticker symbol, or crypto name (e.g. 'apple', 'AAPL', 'ethereum', 'bitcoin')",
  }),
});

interface YahooSearchResponse {
  quotes?: YahooSearchQuote[];
}

interface YahooSearchQuote {
  symbol: string;
  shortname?: string;
  longname?: string;
  quoteType: string;
  exchange: string;
  score: number;
}

interface TradingViewSearchResponse {
  fields?: string[];
  symbols?: Array<{
    s: string;
    f: unknown[];
  }>;
}

const FALLBACK_SEARCH_MAX_RETRY_AFTER_MS = 1_000;

export const searchTickerTool: AgentTool<typeof params> = {
  name: "search_ticker",
  label: "Search Ticker",
  description:
    "Search for any ticker symbol — stocks, crypto, ETFs, indices, forex. Returns matching symbols with names and exchange info. Use this when you don't know the exact ticker for an asset.",
  parameters: params,
  async execute(_toolCallId, args) {
    const yahoo = await searchYahoo(args.query);
    const fallback = yahoo.quotes.length > 0 ? { quotes: [] } : await searchTradingView(args.query);
    const quotes = yahoo.quotes.length > 0 ? yahoo.quotes : fallback.quotes;

    if (quotes.length === 0) {
      const fallbackError = "error" in fallback ? fallback.error : undefined;
      return {
        content: [
          {
            type: "text",
            text: formatNoResultsText(args.query, yahoo.error, fallbackError),
          },
        ],
        details: quotes,
      };
    }

    const lines = [
      `**Search results for "${args.query}"** — ${quotes.length} matches${yahoo.quotes.length === 0 ? " (TradingView fallback)" : ""}`,
      "",
      ...quotes.map(
        (q) =>
          `  ${q.symbol} — ${q.longname || q.shortname || "N/A"} (${q.quoteType}, ${q.exchange})`,
      ),
    ];

    return { content: [{ type: "text", text: lines.join("\n") }], details: quotes };
  },
};

function formatNoResultsText(
  query: string,
  yahooError?: string,
  tradingViewError?: string,
): string {
  if (yahooError && tradingViewError) {
    return `No results found for "${query}". Yahoo search was unavailable (${yahooError}), and the TradingView fallback was unavailable (${tradingViewError}).`;
  }
  if (yahooError) {
    return `No results found for "${query}". Yahoo search was unavailable (${yahooError}), and the TradingView fallback found no equity matches.`;
  }
  if (tradingViewError) {
    return `No results found for "${query}". TradingView fallback was unavailable (${tradingViewError}).`;
  }
  return `No results found for "${query}"`;
}

async function searchYahoo(query: string): Promise<{ quotes: YahooSearchQuote[]; error?: string }> {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=10&newsCount=0`;
  try {
    await rateLimiter.acquire("yahoo");
    const data = await httpGet<YahooSearchResponse>(url, {
      headers: { "User-Agent": "OpenCandle/1.0" },
      maxRetryAfterMs: FALLBACK_SEARCH_MAX_RETRY_AFTER_MS,
    });
    return { quotes: data.quotes ?? [] };
  } catch (error) {
    return {
      quotes: [],
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

async function searchTradingView(
  query: string,
): Promise<{ quotes: YahooSearchQuote[]; error?: string }> {
  const normalized = query.trim();
  if (!normalized) return { quotes: [] };

  try {
    const exactTicker = normalizeTickerQuery(normalized);
    if (exactTicker) {
      const exact = await fetchTradingViewSearch(
        buildTradingViewSearchBody({
          query: normalized,
          ticker: exactTicker,
          mode: "ticker",
        }),
      );
      const exactQuotes = decodeTradingViewSearch(exact, normalized).slice(0, 10);
      if (exactQuotes.length > 0) return { quotes: exactQuotes };
    }

    const matched = await fetchTradingViewSearch(
      buildTradingViewSearchBody({
        query: normalized,
        mode: "description",
      }),
    );
    return { quotes: decodeTradingViewSearch(matched, normalized).slice(0, 10) };
  } catch (error) {
    return {
      quotes: [],
      error: error instanceof Error ? error.message : "unknown_error",
    };
  }
}

async function fetchTradingViewSearch(
  body: ReturnType<typeof buildTradingViewSearchBody>,
): Promise<TradingViewSearchResponse> {
  await rateLimiter.acquire("tradingview");
  return await httpPost<TradingViewSearchResponse>(
    "https://scanner.tradingview.com/america/scan2?label-product=screener-stock",
    body,
    {
      headers: {
        Origin: "https://www.tradingview.com",
        Referer: "https://www.tradingview.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
    },
  );
}

function buildTradingViewSearchBody(options: {
  query: string;
  mode: "ticker" | "description";
  ticker?: string;
}) {
  const columns = ["name", "description", "exchange", "type", "typespecs"] as const;
  const filter =
    options.mode === "ticker" && options.ticker
      ? [
          { left: "name", operation: "equal", right: options.ticker },
          { left: "is_primary", operation: "equal", right: true },
          { left: "type", operation: "in_range", right: ["stock", "fund", "dr"] },
        ]
      : [
          { left: "description", operation: "match", right: options.query },
          { left: "type", operation: "in_range", right: ["stock", "fund", "dr"] },
        ];

  return {
    markets: ["america"],
    columns,
    filter,
    sort: { sortBy: "market_cap_basic", sortOrder: "desc" },
    range: [0, 10],
    options: { lang: "en" },
  };
}

function decodeTradingViewSearch(
  response: TradingViewSearchResponse,
  query: string,
): YahooSearchQuote[] {
  const fields = response.fields ?? [];
  const queryTicker = normalizeTickerQuery(query);
  return (response.symbols ?? [])
    .map((row, index) => {
      const values = Object.fromEntries(
        fields.map((field, fieldIndex) => [field, row.f[fieldIndex]]),
      );
      const symbol = stringValue(values.name) ?? symbolFromTvSymbol(row.s);
      const longname = stringValue(values.description);
      const exchange = stringValue(values.exchange) ?? exchangeFromTvSymbol(row.s);
      return {
        symbol,
        shortname: longname,
        longname,
        quoteType: quoteTypeFromTradingView(values.type, values.typespecs),
        exchange,
        score: scoreTradingViewResult({ symbol, exchange, index, queryTicker }),
      };
    })
    .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
}

function scoreTradingViewResult(opts: {
  symbol: string;
  exchange: string;
  index: number;
  queryTicker?: string;
}): number {
  let score = 50_000 - opts.index;
  if (opts.queryTicker && opts.symbol.toUpperCase() === opts.queryTicker) score += 50_000;
  const exchange = opts.exchange.toUpperCase();
  if (exchange === "NASDAQ" || exchange === "NYSE") score += 1_000;
  if (exchange === "AMEX") score += 500;
  return score;
}

function quoteTypeFromTradingView(type: unknown, typespecs: unknown): string {
  const normalizedType = stringValue(type)?.toLowerCase();
  const normalizedSpecs = Array.isArray(typespecs)
    ? typespecs.map((value) => String(value).toLowerCase())
    : [];
  if (normalizedType === "fund" && normalizedSpecs.includes("etf")) return "ETF";
  if (normalizedType === "fund") return "MUTUALFUND";
  if (normalizedType === "dr") return "EQUITY";
  return "EQUITY";
}

function normalizeTickerQuery(query: string): string | undefined {
  const normalized = query.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9.-]{0,9}$/.test(normalized) ? normalized : undefined;
}

function symbolFromTvSymbol(tvSymbol: string): string {
  return tvSymbol.includes(":") ? (tvSymbol.split(":").at(-1) ?? tvSymbol) : tvSymbol;
}

function exchangeFromTvSymbol(tvSymbol: string): string {
  return tvSymbol.includes(":") ? tvSymbol.split(":")[0] : "";
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
