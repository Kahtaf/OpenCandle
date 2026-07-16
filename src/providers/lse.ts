import { getConfig } from "../config.js";
import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { markExhausted, recordBytes } from "../infra/lse-byte-budget.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import { ProviderCredentialError } from "./provider-credential-error.js";

const BASE_URL = "https://api.londonstrategicedge.com/vault";
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1_000;
const MAX_RETRY_AFTER_MS = 5_000;

export type LseTimeframe = "1m" | "5m" | "15m" | "1h" | "1d" | "1w" | "1mo";

export interface LseCandle {
  ts: string;
  symbol: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// The 6.2 mapper is deliberately deferred until real financial-report fixtures exist.
export type LseFinancialReportRow = Record<string, unknown>;

interface LseCandleOptions {
  start?: string;
  end?: string;
  order?: "asc" | "desc";
  limit?: number;
}

interface LseFinancialReportOptions {
  period?: "FY" | "Q1" | "Q2" | "Q3" | "Q4";
  start?: string;
  end?: string;
  order?: "asc" | "desc";
  limit?: number;
}

export class LseHttpError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`LSE HTTP ${status}: ${detail}`);
    this.name = "LseHttpError";
  }
}

function throwIfLseAuthError(error: unknown): void {
  if (error instanceof ProviderCredentialError && error.provider === "lse") throw error;
  if (error instanceof LseHttpError && (error.status === 401 || error.status === 403)) {
    throw new ProviderCredentialError("lse", "stale", error.status);
  }
}

async function readErrorDetail(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: unknown };
    if (typeof body.detail === "string") return body.detail;
  } catch {
    // Preserve a useful typed HTTP error even when the provider body is not JSON.
  }
  return response.statusText || `HTTP ${response.status}`;
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;

  const dateMs = Date.parse(value.trim());
  if (Number.isNaN(dateMs)) return undefined;
  return Math.max(0, dateMs - Date.now());
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function lseGet<T>(path: string, params: Record<string, string>): Promise<T> {
  const apiKey = getConfig().lseApiKey;
  if (!apiKey) throw new ProviderCredentialError("lse", "missing");

  const url = `${BASE_URL}${path}?${new URLSearchParams(params)}`;
  let lastError: LseHttpError | undefined;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const response = await globalThis.fetch(url, { headers: { "x-api-key": apiKey } });
    const dataBytes = response.headers.get("x-data-bytes");
    if (dataBytes !== null) {
      const parsedBytes = Number(dataBytes);
      if (Number.isFinite(parsedBytes)) recordBytes(parsedBytes);
    }
    if (response.ok) return (await response.json()) as T;

    const error = new LseHttpError(response.status, await readErrorDetail(response));
    throwIfLseAuthError(error);
    lastError = error;

    if (response.status === 429 && error.detail.toLowerCase().includes("allowance")) {
      markExhausted();
      throw error;
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) throw error;

    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    await sleep(
      retryAfterMs === undefined
        ? RETRY_DELAY_MS * (attempt + 1)
        : Math.min(retryAfterMs, MAX_RETRY_AFTER_MS),
    );
  }

  throw lastError ?? new Error("LSE request failed without an error");
}

export async function getLseCandles(
  symbol: string,
  timeframe: LseTimeframe,
  opts: LseCandleOptions = {},
): Promise<LseCandle[]> {
  const params: Record<string, string> = { symbol, timeframe };
  if (opts.start !== undefined) params.start = opts.start;
  if (opts.end !== undefined) params.end = opts.end;
  if (opts.order !== undefined) params.order = opts.order;
  if (opts.limit !== undefined) params.limit = String(opts.limit);
  const cacheKey = `lse:candles:${new URLSearchParams(params)}`;
  const cached = cache.get<LseCandle[]>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("lse");
    const rows = await lseGet<LseCandle[]>("/candles", params);
    cache.set(cacheKey, rows, TTL.CANDLES);
    return rows;
  } catch (error) {
    throwIfLseAuthError(error);
    const stale = cache.getStale<LseCandle[]>(cacheKey, STALE_LIMIT.CANDLES);
    if (stale) return stale.value;
    throw error;
  }
}

export async function getLseFinancialReports(
  symbol: string,
  reportType: "income" | "balance" | "cashflow",
  opts: LseFinancialReportOptions = {},
): Promise<LseFinancialReportRow[]> {
  const params: Record<string, string> = { symbol, report_type: reportType };
  if (opts.period !== undefined) params.period = opts.period;
  if (opts.start !== undefined) params.start = opts.start;
  if (opts.end !== undefined) params.end = opts.end;
  if (opts.order !== undefined) params.order = opts.order;
  if (opts.limit !== undefined) params.limit = String(opts.limit);
  const cacheKey = `lse:financial_reports:${new URLSearchParams(params)}`;
  const cached = cache.get<LseFinancialReportRow[]>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("lse");
    const rows = await lseGet<LseFinancialReportRow[]>("/ref/financial_reports", params);
    cache.set(cacheKey, rows, TTL.FINANCIAL_REPORTS);
    return rows;
  } catch (error) {
    throwIfLseAuthError(error);
    const stale = cache.getStale<LseFinancialReportRow[]>(cacheKey, STALE_LIMIT.FINANCIAL_REPORTS);
    if (stale) return stale.value;
    throw error;
  }
}

export function toLseTimeframe(interval: string): LseTimeframe | undefined {
  const timeframes: Record<string, LseTimeframe> = {
    "1m": "1m",
    "5m": "5m",
    "15m": "15m",
    "1h": "1h",
    "1d": "1d",
    "1wk": "1w",
    "1mo": "1mo",
  };
  return timeframes[interval];
}
