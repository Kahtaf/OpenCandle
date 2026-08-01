import { cache, TTL } from "../infra/cache.js";
import { httpGet } from "../infra/http-client.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import { wrapProvider } from "../providers/wrap-provider.js";
import { getQuote } from "../providers/yahoo-finance.js";
import type { StockQuote } from "../types/market.js";
import type { InstrumentInput } from "./service.js";

export interface InstrumentCandidate {
  symbol: string;
  name: string | null;
  quoteType: string;
  assetType: string;
  exchange: string | null;
  provider: "yahoo";
  score: number | null;
}

interface YahooSearchResponse {
  quotes?: Array<{
    symbol?: string;
    shortname?: string;
    longname?: string;
    quoteType?: string;
    exchange?: string;
    score?: number;
  }>;
}

export async function searchYahooInstruments(query: string): Promise<InstrumentCandidate[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const cacheKey = `yahoo:instrument-search:${trimmed.toLowerCase()}`;
  const cached = cache.get<InstrumentCandidate[]>(cacheKey);
  if (cached) return cached;

  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(trimmed)}&quotesCount=10&newsCount=0`;
  await rateLimiter.acquire("yahoo");
  const data = await httpGet<YahooSearchResponse>(url, {
    headers: { "User-Agent": "OpenCandle/1.0" },
  });

  const candidates = (data.quotes ?? []).flatMap((quote) => {
    if (!quote.symbol) return [];
    const quoteType = quote.quoteType ?? "UNKNOWN";
    return [
      {
        symbol: quote.symbol.toUpperCase(),
        name: quote.longname ?? quote.shortname ?? null,
        quoteType,
        assetType: assetTypeFromQuoteType(quoteType, quote.symbol),
        exchange: quote.exchange ?? null,
        provider: "yahoo" as const,
        score: quote.score ?? null,
      },
    ];
  });
  cache.set(cacheKey, candidates, TTL.WEB_SEARCH);
  return candidates;
}

export async function resolveYahooInstrument(symbol: string): Promise<InstrumentInput> {
  const normalized = symbol.trim().toUpperCase();
  if (!normalized) {
    throw new Error("symbol is required.");
  }

  const result = await wrapProvider("yahoo", () => getQuote(normalized));
  if (result.status === "unavailable") {
    throw new Error(`Could not resolve ${normalized}: ${result.reason}`);
  }

  const quote = result.data;
  if (isZeroFilledQuote(quote)) {
    throw new Error(`Could not resolve ${normalized}: Yahoo returned no valid market data.`);
  }

  return {
    symbol: quote.symbol?.toUpperCase() ?? normalized,
    assetType: inferAssetType(quote.symbol ?? normalized),
    currency: quote.currency?.trim().toUpperCase() || null,
    provider: "yahoo",
    providerMetadata: {
      price: quote.price,
      volume: quote.volume,
      week52High: quote.week52High,
      week52Low: quote.week52Low,
      timestamp: quote.timestamp,
    },
  };
}

export function isZeroFilledQuote(quote: StockQuote): boolean {
  return quote.price === 0 && quote.volume === 0 && quote.week52High === 0 && quote.week52Low === 0;
}

function inferAssetType(symbol: string): string {
  if (/^[A-Z0-9]{2,10}-[A-Z0-9]{3,10}$/.test(symbol)) return "crypto";
  if (symbol.startsWith("^")) return "index";
  return "equity";
}

function assetTypeFromQuoteType(quoteType: string, symbol: string): string {
  const normalized = quoteType.toLowerCase();
  if (normalized.includes("etf")) return "etf";
  if (normalized.includes("mutualfund")) return "fund";
  if (normalized.includes("crypto")) return "crypto";
  if (normalized.includes("index")) return "index";
  if (normalized.includes("equity")) return "equity";
  return inferAssetType(symbol.toUpperCase());
}
