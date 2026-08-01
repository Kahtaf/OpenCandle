import { cache } from "../../src/infra/cache.js";
import { rateLimiter } from "../../src/infra/rate-limiter.js";
import {
  isTickerLineSvg,
  readTickerLineTextWithLimit,
  TICKER_LINE_MAX_SVG_BYTES,
  tickerLineProviderSparklineUrl,
  tickerLineResponseFailure,
} from "../shared/ticker-line.js";

const CACHE_TTL_MS = 5 * 60_000;

export type TickerLineSparklineResult =
  | { status: "ok"; svg: string; dataAsOf?: string }
  | { status: "invalid_request"; reason: string }
  | { status: "unavailable"; reason: string };

const inFlightSparklines = new Map<string, Promise<TickerLineSparklineResult>>();

export async function fetchTickerLineSparkline(
  symbol: string,
  assetType: string,
): Promise<TickerLineSparklineResult> {
  const providerUrl = tickerLineProviderSparklineUrl(symbol, assetType);
  if (!providerUrl) {
    return { status: "invalid_request", reason: "Unsupported Ticker Line instrument" };
  }

  const cacheKey = `ticker-line:sparkline:${providerUrl}`;
  const cached = cache.get<{ svg: string; dataAsOf?: string }>(cacheKey);
  if (cached) return { status: "ok", ...cached };

  const existing = inFlightSparklines.get(cacheKey);
  if (existing) return existing;

  const request = fetchAndCacheTickerLineSparkline(providerUrl, cacheKey);
  inFlightSparklines.set(cacheKey, request);
  try {
    return await request;
  } finally {
    if (inFlightSparklines.get(cacheKey) === request) inFlightSparklines.delete(cacheKey);
  }
}

async function fetchAndCacheTickerLineSparkline(
  providerUrl: string,
  cacheKey: string,
): Promise<TickerLineSparklineResult> {
  try {
    await rateLimiter.acquire("ticker_line");
    const response = await fetch(providerUrl, {
      headers: { accept: "image/svg+xml" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { status: "unavailable", reason: `Ticker Line returned HTTP ${response.status}` };
    }
    const responseFailure = tickerLineResponseFailure(response.headers);
    if (responseFailure) return { status: "unavailable", reason: responseFailure };
    const body = await readTickerLineTextWithLimit(response, TICKER_LINE_MAX_SVG_BYTES);
    if (body.status === "too_large") {
      return { status: "unavailable", reason: "Ticker Line SVG exceeded the size limit" };
    }
    const svg = body.text;
    if (!isTickerLineSvg(svg)) {
      return { status: "unavailable", reason: "Ticker Line returned an invalid SVG" };
    }
    const dataAsOf = response.headers.get("x-data-as-of") ?? undefined;
    cache.set(cacheKey, { svg, dataAsOf }, CACHE_TTL_MS);
    return { status: "ok", svg, dataAsOf };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "Ticker Line request failed",
    };
  }
}
