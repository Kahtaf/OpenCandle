import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { HttpError, httpGet } from "../infra/http-client.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import { ProviderCredentialError } from "./provider-credential-error.js";

const FINNHUB_BASE = "https://finnhub.io/api/v1";

export interface FinnhubArticle {
  headline: string;
  summary: string;
  source: string;
  datetime: number;
  url: string;
  related: string;
  id: number;
  category: string;
  image: string;
}

// Ticker → company name mapping for relevance filtering
const TICKER_NAMES: Record<string, string> = {
  AAPL: "apple",
  MSFT: "microsoft",
  GOOGL: "google",
  GOOG: "google",
  AMZN: "amazon",
  META: "meta",
  TSLA: "tesla",
  NVDA: "nvidia",
  TSM: "tsmc",
  BABA: "alibaba",
  NFLX: "netflix",
  AMD: "amd",
  INTC: "intel",
  CRM: "salesforce",
  ORCL: "oracle",
};

export function finnhubDateRange(freshness: "hours" | "day" | "week" | "month"): {
  from: string;
  to: string;
} {
  const now = new Date();
  const to = formatDate(now);

  switch (freshness) {
    case "hours":
      return { from: to, to };
    case "day": {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return { from: formatDate(d), to };
    }
    case "week": {
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      return { from: formatDate(d), to };
    }
    case "month": {
      const d = new Date(now);
      d.setDate(d.getDate() - 30);
      return { from: formatDate(d), to };
    }
  }
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function cacheKey(symbol: string, from: string, to: string): string {
  return `finnhub:news:${symbol}:${from}:${to}`;
}

export function filterByRelevance(
  articles: FinnhubArticle[],
  symbol: string,
  limit = 20,
): FinnhubArticle[] {
  const symLower = symbol.toLowerCase();
  const companyName = TICKER_NAMES[symbol.toUpperCase()];

  const filtered = articles.filter((a) => {
    const hl = a.headline.toLowerCase();
    const sm = a.summary.toLowerCase();
    if (hl.includes(symLower) || sm.includes(symLower)) return true;
    if (companyName && (hl.includes(companyName) || sm.includes(companyName))) return true;
    return false;
  });

  // Most recent first, capped
  return filtered.sort((a, b) => b.datetime - a.datetime).slice(0, limit);
}

export async function getCompanyNews(
  symbol: string,
  from: string,
  to: string,
  apiKey: string,
): Promise<FinnhubArticle[]> {
  const key = cacheKey(symbol, from, to);
  const cached = cache.get<FinnhubArticle[]>(key);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("finnhub");

    const url = `${FINNHUB_BASE}/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${apiKey}`;
    const data = await httpGet<FinnhubArticle[]>(url);

    const articles = Array.isArray(data) ? data : [];
    const filtered = filterByRelevance(articles, symbol);

    cache.set(key, filtered, TTL.FINNHUB_NEWS);
    return filtered;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      throw new ProviderCredentialError("finnhub", "stale", error.status);
    }

    const stale = cache.getStale<FinnhubArticle[]>(key, STALE_LIMIT.FINNHUB_NEWS);
    if (stale) return stale.value;
    throw error;
  }
}
