import { cache } from "../../src/infra/cache.js";
import { rateLimiter } from "../../src/infra/rate-limiter.js";
import { tickerLineProviderSparklineUrl } from "../shared/ticker-line.js";

const CACHE_TTL_MS = 5 * 60_000;
const MAX_SVG_BYTES = 512 * 1024;

export type TickerLineSparklineResult =
  | { status: "ok"; svg: string }
  | { status: "invalid_request"; reason: string }
  | { status: "unavailable"; reason: string };

export async function fetchTickerLineSparkline(
  symbol: string,
  assetType: string,
): Promise<TickerLineSparklineResult> {
  const providerUrl = tickerLineProviderSparklineUrl(symbol, assetType);
  if (!providerUrl) {
    return { status: "invalid_request", reason: "Unsupported Ticker Line instrument" };
  }

  const cacheKey = `ticker-line:sparkline:${providerUrl}`;
  const cached = cache.get<string>(cacheKey);
  if (cached) return { status: "ok", svg: cached };

  try {
    await rateLimiter.acquire("ticker_line");
    const response = await fetch(providerUrl, {
      headers: { accept: "image/svg+xml" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      return { status: "unavailable", reason: `Ticker Line returned HTTP ${response.status}` };
    }
    const semanticError = tickerLineError(response.headers);
    if (semanticError) {
      return { status: "unavailable", reason: semanticError };
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_SVG_BYTES) {
      return { status: "unavailable", reason: "Ticker Line SVG exceeded the size limit" };
    }
    const svg = await response.text();
    if (
      Buffer.byteLength(svg) > MAX_SVG_BYTES ||
      !/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg.trimStart())
    ) {
      return { status: "unavailable", reason: "Ticker Line returned an invalid SVG" };
    }
    cache.set(cacheKey, svg, CACHE_TTL_MS);
    return { status: "ok", svg };
  } catch (error) {
    return {
      status: "unavailable",
      reason: error instanceof Error ? error.message : "Ticker Line request failed",
    };
  }
}

function tickerLineError(headers: Headers): string | null {
  const code = headers.get("x-error-code");
  const status = headers.get("x-error-status");
  const message = headers.get("x-error-message") ?? headers.get("x-ticker-line-error");
  if (!(code || status || message)) return null;
  return `Ticker Line unavailable: ${message ?? code ?? status}`;
}
