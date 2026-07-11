import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { httpGet } from "../infra/http-client.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { PredictionMarketQuote } from "../types/prediction-markets.js";

const BASE_URL = "https://gamma-api.polymarket.com";
const POLYMARKET_URL = "https://polymarket.com";

interface GammaSearchResponse {
  events?: GammaEvent[];
  markets?: GammaMarket[];
}

interface GammaEvent {
  id?: string | number;
  slug?: string;
  title?: string;
  description?: string;
  resolutionSource?: string;
  endDate?: string;
  volume?: unknown;
  liquidity?: unknown;
  updatedAt?: string;
  markets?: GammaMarket[];
}

interface GammaMarket {
  id?: string | number;
  question?: string;
  slug?: string;
  description?: string;
  resolutionSource?: string;
  outcomes?: unknown;
  outcomePrices?: unknown;
  volume?: unknown;
  volumeNum?: unknown;
  liquidity?: unknown;
  liquidityNum?: unknown;
  endDate?: string;
  endDateIso?: string;
  updatedAt?: string;
  active?: unknown;
  closed?: unknown;
}

interface MarketWithEvent {
  event?: GammaEvent;
  market: GammaMarket;
}

export async function searchPredictionMarkets(
  query: string,
  limit: number = 8,
): Promise<PredictionMarketQuote[]> {
  const normalizedQuery = query.trim();
  const normalizedLimit = normalizeLimit(limit);
  if (!normalizedQuery) return [];

  const cacheKey = `polymarket:search:${normalizedQuery.toLowerCase()}:${normalizedLimit}`;
  const cached = cache.get<PredictionMarketQuote[]>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("polymarket");
    const url = `${BASE_URL}/public-search?q=${encodeURIComponent(normalizedQuery)}&limit=${normalizedLimit}`;
    const response = await httpGet<GammaSearchResponse>(url, {
      headers: { Accept: "application/json" },
      maxRetries: 0,
    });
    const quotes = decodeSearchResponse(response).slice(0, normalizedLimit);
    cache.set(cacheKey, quotes, TTL.PREDICTION_MARKETS);
    return quotes;
  } catch (error) {
    const stale = cache.getStale<PredictionMarketQuote[]>(cacheKey, STALE_LIMIT.PREDICTION_MARKETS);
    if (stale) return stale.value;
    throw error;
  }
}

function decodeSearchResponse(response: GammaSearchResponse): PredictionMarketQuote[] {
  const markets: MarketWithEvent[] = [
    ...(response.events ?? []).flatMap((event) =>
      (event.markets ?? []).map((market) => ({ event, market })),
    ),
    ...(response.markets ?? []).map((market) => ({ market })),
  ];
  return markets.flatMap(({ event, market }) =>
    isOpenMarket(market) ? marketToQuotes(market, event) : [],
  );
}

function marketToQuotes(market: GammaMarket, event?: GammaEvent): PredictionMarketQuote[] {
  const marketId = market.id === undefined ? undefined : String(market.id);
  const title = stringValue(market.question) ?? stringValue(event?.title);
  if (!marketId || !title) return [];

  const outcomes = parseStringArray(market.outcomes);
  const prices = parseNumberArray(market.outcomePrices);
  if (outcomes.length === 0 || prices.length === 0) return [];

  const resolutionCriteria = firstNonEmpty(market.description, market.resolutionSource);
  const volumeUsd =
    numberValue(market.volumeNum) ?? numberValue(market.volume) ?? numberValue(event?.volume);
  const liquidityUsd =
    numberValue(market.liquidityNum) ??
    numberValue(market.liquidity) ??
    numberValue(event?.liquidity);
  const rawCloseDate =
    stringValue(market.endDate) ?? normalizeDateOnly(market.endDateIso ?? event?.endDate);
  // A past close date on a market Gamma explicitly marks active is the same
  // stale metadata isOpenMarket ignores; presenting it as a close date would
  // tell users an open market already closed, so it is omitted instead.
  const closeDate =
    rawCloseDate !== undefined && booleanValue(market.active) === true && isPastDate(rawCloseDate)
      ? undefined
      : rawCloseDate;
  const url = marketUrl(market, event);
  const asOf = stringValue(market.updatedAt) ?? stringValue(event?.updatedAt);

  return outcomes.flatMap((outcome, index) => {
    const probability = prices[index];
    if (probability === undefined || probability < 0 || probability > 1) return [];
    return [
      {
        source: "polymarket" as const,
        marketId,
        title,
        outcome,
        probability,
        ...(volumeUsd !== undefined && { volumeUsd }),
        ...(liquidityUsd !== undefined && { liquidityUsd }),
        ...(closeDate && { closeDate }),
        ...(resolutionCriteria && { resolutionCriteria }),
        url,
        ...(asOf && { asOf }),
      },
    ];
  });
}

function isOpenMarket(market: GammaMarket): boolean {
  const closed = booleanValue(market.closed);
  const active = booleanValue(market.active);
  if (closed === true) return false;
  if (active === false) return false;
  // An explicit affirmative active flag is Gamma's authoritative openness
  // signal and beats the endDate heuristic, whose metadata is demonstrably
  // stale on live markets. A lone `closed: false` only says "not settled",
  // so it still falls through to the date check.
  if (active === true) return true;

  const endDate = stringValue(market.endDate) ?? stringValue(market.endDateIso);
  if (!endDate) return true;
  return !isPastDate(endDate);
}

function isPastDate(value: string): boolean {
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
}

function normalizeLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 8;
  return Math.min(50, Math.max(1, Math.floor(limit)));
}

function parseStringArray(value: unknown): string[] {
  const parsed = parseJsonArray(value);
  return parsed.flatMap((item) => {
    const text = stringValue(item);
    return text ? [text] : [];
  });
}

function parseNumberArray(value: unknown): Array<number | undefined> {
  const parsed = parseJsonArray(value);
  return parsed.map((item) => numberValue(item));
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function numberValue(value: unknown): number | undefined {
  const number =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return undefined;
}

function firstNonEmpty(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = stringValue(value);
    if (text) return text;
  }
  return undefined;
}

function normalizeDateOnly(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value;
}

function marketUrl(market: GammaMarket, event?: GammaEvent): string {
  const marketSlug = stringValue(market.slug);
  const eventSlug = stringValue(event?.slug);
  if (eventSlug && marketSlug) {
    return `${POLYMARKET_URL}/event/${encodeURIComponent(eventSlug)}/${encodeURIComponent(marketSlug)}`;
  }
  if (marketSlug) return `${POLYMARKET_URL}/event/${encodeURIComponent(marketSlug)}`;
  return POLYMARKET_URL;
}
