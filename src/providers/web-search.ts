import type { NewsResult, SearchResult, SearchTimeType } from "ddg-kit";
import { getConfig } from "../config.js";
import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { HttpError, httpGet } from "../infra/http-client.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { ProviderResult } from "../runtime/evidence.js";
import type { WebSearchEnvelope, WebSearchResult } from "../types/sentiment.js";
import { exaSearch } from "./exa-search.js";
import { ProviderCredentialError } from "./provider-credential-error.js";
import { withFallback } from "./with-fallback.js";

export interface WebSearchOpts {
  category: "news" | "general";
  freshness: "hours" | "day" | "week" | "month";
  limit: number;
  /** Override provider: skip cascade, use this provider only. */
  provider?: "exa" | "brave" | "ddg";
  /** Restrict automatic and explicit selection to runtime-negotiated providers. */
  allowedProviders?: readonly ("exa" | "brave" | "ddg")[];
}

const BARE_TICKER = /^[A-Z]{1,5}$/;
const CASHTAG = /^\$[A-Z]{1,5}$/;

/**
 * Normalize queries for financial context.
 * Only applied when category is "news" — general queries pass through unchanged.
 */
export function normalizeFinancialQuery(query: string, category: "news" | "general"): string {
  if (category !== "news") return query;
  if (CASHTAG.test(query)) return `${query.slice(1)} stock news`;
  if (BARE_TICKER.test(query)) return `${query} stock news`;
  return query;
}

function stripHtmlTags(text: string): string {
  return text.replace(/<[^>]*>/g, "");
}

function mapFreshness(freshness: WebSearchOpts["freshness"]): SearchTimeType {
  switch (freshness) {
    case "hours":
      return "d" as SearchTimeType; // closest available
    case "day":
      return "d" as SearchTimeType;
    case "week":
      return "w" as SearchTimeType;
    case "month":
      return "m" as SearchTimeType;
  }
}

function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function mapGeneralResult(r: SearchResult): WebSearchResult {
  return {
    title: r.title,
    url: r.url,
    snippet: stripHtmlTags(r.description),
    source: r.hostname || extractDomain(r.url),
    published: null,
    category: "general",
  };
}

function mapNewsResult(r: NewsResult): WebSearchResult {
  return {
    title: r.title,
    url: r.url,
    snippet: r.excerpt,
    source: r.syndicate || extractDomain(r.url),
    published: r.date ? new Date(r.date * 1000).toISOString() : null,
    category: "news",
  };
}

function ddgCacheKey(query: string, opts: WebSearchOpts): string {
  return `web:ddg:${query}:${opts.category}:${opts.freshness}:${opts.limit}`;
}

export async function ddgSearch(query: string, opts: WebSearchOpts): Promise<WebSearchEnvelope> {
  const key = ddgCacheKey(query, opts);
  const cached = cache.get<WebSearchEnvelope>(key);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("ddg");
    const { SafeSearchType, search, searchNews } = await import("ddg-kit");

    let results: WebSearchResult[];

    if (opts.category === "news") {
      const response = await searchNews(
        query,
        { time: mapFreshness(opts.freshness), safeSearch: SafeSearchType.STRICT },
        undefined,
      );
      results = (response.results || []).slice(0, opts.limit).map(mapNewsResult);
    } else {
      const response = await search(
        query,
        { time: mapFreshness(opts.freshness), safeSearch: SafeSearchType.STRICT },
        undefined,
      );
      results = (response.results || []).slice(0, opts.limit).map(mapGeneralResult);
    }

    const envelope: WebSearchEnvelope = {
      query,
      results,
      resultCount: results.length,
      fetchedAt: new Date().toISOString(),
      provider: "ddg",
    };

    cache.set(key, envelope, TTL.WEB_SEARCH);
    return envelope;
  } catch (error) {
    const stale = cache.getStale<WebSearchEnvelope>(key, STALE_LIMIT.WEB_SEARCH);
    if (stale) return stale.value;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Brave Search
// ---------------------------------------------------------------------------

const BRAVE_BASE = "https://api.search.brave.com/res/v1";

function mapBraveFreshness(freshness: WebSearchOpts["freshness"]): string {
  switch (freshness) {
    case "hours":
      return "ph";
    case "day":
      return "pd";
    case "week":
      return "pw";
    case "month":
      return "pm";
  }
}

interface BraveNewsResult {
  title: string;
  url: string;
  description: string;
  age?: string;
  source?: string;
  meta_url?: { hostname: string };
}

interface BraveWebResult {
  title: string;
  url: string;
  description: string;
  age?: string | null;
  meta_url?: { hostname: string };
}

function mapBraveNewsResult(r: BraveNewsResult): WebSearchResult {
  return {
    title: r.title,
    url: r.url,
    snippet: r.description,
    source: r.source || r.meta_url?.hostname || extractDomain(r.url),
    published: null, // Brave news returns relative "age" not absolute timestamps
    category: "news",
  };
}

function mapBraveWebResult(r: BraveWebResult): WebSearchResult {
  return {
    title: r.title,
    url: r.url,
    snippet: r.description,
    source: r.meta_url?.hostname || extractDomain(r.url),
    published: null,
    category: "general",
  };
}

function braveCacheKey(query: string, opts: WebSearchOpts): string {
  return `web:brave:${query}:${opts.category}:${opts.freshness}:${opts.limit}`;
}

export async function braveSearch(
  query: string,
  opts: WebSearchOpts,
  apiKey: string,
): Promise<WebSearchEnvelope> {
  const key = braveCacheKey(query, opts);
  const cached = cache.get<WebSearchEnvelope>(key);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("brave_search");

    const endpoint = opts.category === "news" ? "news/search" : "web/search";
    const freshness = mapBraveFreshness(opts.freshness);
    const url = `${BRAVE_BASE}/${endpoint}?q=${encodeURIComponent(query)}&count=${opts.limit}&freshness=${freshness}`;

    const data = await httpGet<Record<string, unknown>>(url, {
      headers: {
        "X-Subscription-Token": apiKey,
        Accept: "application/json",
      },
    });

    let results: WebSearchResult[];
    if (opts.category === "news") {
      const newsResults = ((data as any).results || []) as BraveNewsResult[];
      results = newsResults.slice(0, opts.limit).map(mapBraveNewsResult);
    } else {
      const webResults = ((data as any).web?.results || []) as BraveWebResult[];
      results = webResults.slice(0, opts.limit).map(mapBraveWebResult);
    }

    const envelope: WebSearchEnvelope = {
      query,
      results,
      resultCount: results.length,
      fetchedAt: new Date().toISOString(),
      provider: "brave",
    };

    cache.set(key, envelope, TTL.WEB_SEARCH);
    return envelope;
  } catch (error: any) {
    const status = error instanceof HttpError ? error.status : error?.statusCode;
    if (status === 401 || status === 403) {
      throw new ProviderCredentialError("brave", "stale", status);
    }

    const stale = cache.getStale<WebSearchEnvelope>(key, STALE_LIMIT.WEB_SEARCH);
    if (stale) return stale.value;
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Cascade orchestrator
// ---------------------------------------------------------------------------

const DEFAULT_OPTS: WebSearchOpts = {
  category: "news",
  freshness: "day",
  limit: 10,
};

export async function searchWeb(
  query: string,
  opts?: Partial<WebSearchOpts>,
): Promise<ProviderResult<WebSearchEnvelope>> {
  const resolved: WebSearchOpts = { ...DEFAULT_OPTS, ...opts };
  const normalized = normalizeFinancialQuery(query, resolved.category);
  const config = getConfig();

  const entries: Array<{ provider: string; fn: () => Promise<WebSearchEnvelope> }> = [];
  const allowedProviders = resolved.allowedProviders ?? ["exa", "brave", "ddg"];

  // Provider override: skip cascade, use only the specified provider
  if (resolved.provider) {
    if (!allowedProviders.includes(resolved.provider)) {
      return { status: "unavailable", reason: "provider not allowed", provider: resolved.provider };
    }
    switch (resolved.provider) {
      case "exa":
        entries.push({ provider: "exa", fn: () => exaSearch(normalized, resolved) });
        break;
      case "brave":
        {
          const braveApiKey = config.braveApiKey;
          if (!braveApiKey) {
            return {
              status: "unavailable",
              reason: "BRAVE_API_KEY not configured",
              provider: "brave_search",
            };
          }
          entries.push({
            provider: "brave_search",
            fn: () => braveSearch(normalized, resolved, braveApiKey),
          });
        }
        break;
      case "ddg":
        entries.push({ provider: "ddg", fn: () => ddgSearch(normalized, resolved) });
        break;
    }
    return withFallback<WebSearchEnvelope>(entries);
  }

  // Default cascade: Exa → Brave → DDG, bounded by the negotiated runtime policy.
  if (allowedProviders.includes("exa")) {
    entries.push({ provider: "exa", fn: () => exaSearch(normalized, resolved) });
  }
  const braveApiKey = config.braveApiKey;
  if (allowedProviders.includes("brave") && braveApiKey) {
    entries.push({
      provider: "brave_search",
      fn: () => braveSearch(normalized, resolved, braveApiKey),
    });
  }
  if (allowedProviders.includes("ddg")) {
    entries.push({ provider: "ddg", fn: () => ddgSearch(normalized, resolved) });
  }

  return withFallback<WebSearchEnvelope>(entries);
}
