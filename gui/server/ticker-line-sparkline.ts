import { cache } from "../../src/infra/cache.js";
import { rateLimiter } from "../../src/infra/rate-limiter.js";
import { tickerLineProviderSparklineUrl } from "../shared/ticker-line.js";

const CACHE_TTL_MS = 5 * 60_000;
const MAX_SVG_BYTES = 512 * 1024;

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
    const semanticError = tickerLineError(response.headers);
    if (semanticError) {
      return { status: "unavailable", reason: semanticError };
    }
    if (response.headers.get("x-cache")?.toUpperCase() === "STALE") {
      const dataAsOf = response.headers.get("x-data-as-of");
      return {
        status: "unavailable",
        reason: `Ticker Line returned stale market data${dataAsOf ? ` as of ${dataAsOf}` : ""}`,
      };
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_SVG_BYTES) {
      return { status: "unavailable", reason: "Ticker Line SVG exceeded the size limit" };
    }
    const body = await readTextWithLimit(response, MAX_SVG_BYTES);
    if (body.status === "too_large") {
      return { status: "unavailable", reason: "Ticker Line SVG exceeded the size limit" };
    }
    const svg = body.text;
    if (!/^(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(svg.trimStart())) {
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

async function readTextWithLimit(
  response: Response,
  maxBytes: number,
): Promise<{ status: "ok"; text: string } | { status: "too_large" }> {
  if (!response.body) return { status: "ok", text: "" };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > maxBytes) {
        await reader.cancel();
        return { status: "too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return { status: "ok", text };
  } finally {
    reader.releaseLock();
  }
}

function tickerLineError(headers: Headers): string | null {
  const code = headers.get("x-error-code");
  const status = headers.get("x-error-status");
  const message = headers.get("x-error-message") ?? headers.get("x-ticker-line-error");
  if (!(code || status || message)) return null;
  return `Ticker Line unavailable: ${message ?? code ?? status}`;
}
