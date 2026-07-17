import { getConfig } from "../config.js";
import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { markExhausted, recordBytes } from "../infra/lse-byte-budget.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { FinancialStatement } from "../types/fundamentals.js";
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
  if (opts.start !== undefined) params.start = opts.start.slice(0, 10);
  if (opts.end !== undefined) params.end = opts.end;
  if (opts.order !== undefined) params.order = opts.order;
  if (opts.limit !== undefined) params.limit = String(opts.limit);
  const cacheKey = `lse:candles:${new URLSearchParams(params)}`;
  const cached = cache.get<LseCandle[]>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("lse");
    const rows = await lseGet<LseCandle[]>("/candles", params);
    if (!isValidLseCandlePayload(rows)) {
      throw new Error("LSE candles response did not contain valid candle rows");
    }
    cache.set(cacheKey, rows, TTL.CANDLES);
    return rows;
  } catch (error) {
    throwIfLseAuthError(error);
    const stale = cache.getStale<LseCandle[]>(cacheKey, STALE_LIMIT.CANDLES);
    if (stale) return stale.value;
    throw error;
  }
}

function isValidLseCandlePayload(value: unknown): value is LseCandle[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((row) => {
      if (typeof row !== "object" || row === null) return false;
      const candle = row as Partial<LseCandle>;
      const timestamp =
        typeof candle.ts === "string"
          ? Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(candle.ts) ? candle.ts : `${candle.ts}Z`)
          : Number.NaN;
      const prices = [candle.open, candle.high, candle.low, candle.close];
      return (
        Number.isFinite(timestamp) &&
        prices.every((price) => typeof price === "number" && Number.isFinite(price) && price > 0) &&
        (candle.high ?? 0) >= Math.max(candle.open ?? 0, candle.close ?? 0) &&
        (candle.low ?? Number.POSITIVE_INFINITY) <=
          Math.min(
            candle.open ?? Number.POSITIVE_INFINITY,
            candle.close ?? Number.POSITIVE_INFINITY,
          ) &&
        typeof candle.volume === "number" &&
        Number.isFinite(candle.volume) &&
        candle.volume >= 0
      );
    })
  );
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

function parseNum(value: unknown): number | undefined {
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseReportData(row: LseFinancialReportRow): Record<string, unknown> | undefined {
  if (typeof row.data !== "string") return undefined;
  try {
    const parsed: unknown = JSON.parse(row.data);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function indexReportData(rows: LseFinancialReportRow[]): Map<string, Record<string, unknown>> {
  const indexed = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (typeof row.date !== "string") continue;
    const data = parseReportData(row);
    if (data) indexed.set(row.date, data);
  }
  return indexed;
}

export async function getLseFinancials(symbol: string): Promise<FinancialStatement[]> {
  const [incomeRows, balanceRows, cashflowRows] = await Promise.all([
    getLseFinancialReports(symbol, "income", { period: "FY" }),
    getLseFinancialReports(symbol, "balance", { period: "FY" }),
    getLseFinancialReports(symbol, "cashflow", { period: "FY" }),
  ]);
  const balanceByDate = indexReportData(balanceRows);
  const cashflowByDate = indexReportData(cashflowRows);

  const statements = incomeRows
    .flatMap((row) => {
      if (typeof row.date !== "string") return [];
      const income = parseReportData(row);
      return income ? [{ date: row.date, income }] : [];
    })
    .sort((a, b) => b.date.localeCompare(a.date))
    .flatMap(({ date, income }) => {
      const balance = balanceByDate.get(date);
      const cashflow = cashflowByDate.get(date);
      if (!balance || !cashflow) return [];
      const revenue = parseNum(income.revenue);
      const grossProfit = parseNum(income.grossProfit);
      const operatingIncome = parseNum(income.operatingIncome);
      const netIncome = parseNum(income.netIncome);
      const eps = parseNum(income.eps);
      const totalAssets = parseNum(balance.totalAssets);
      const totalLiabilities = parseNum(balance.totalLiabilities);
      const totalEquity = parseNum(balance.totalEquity);
      const operatingCashFlow = parseNum(cashflow.operatingCashFlow);
      const reportedFreeCashFlow = parseNum(cashflow.freeCashFlow);
      const capitalExpenditure = parseNum(cashflow.capitalExpenditure);
      const freeCashFlow =
        reportedFreeCashFlow ??
        (operatingCashFlow !== undefined && capitalExpenditure !== undefined
          ? // LSE capex is negative; subtract its magnitude to match AV's positive-capex semantics.
            operatingCashFlow - Math.abs(capitalExpenditure)
          : undefined);

      if (
        revenue === undefined ||
        grossProfit === undefined ||
        operatingIncome === undefined ||
        netIncome === undefined ||
        eps === undefined ||
        totalAssets === undefined ||
        totalLiabilities === undefined ||
        totalEquity === undefined ||
        operatingCashFlow === undefined ||
        freeCashFlow === undefined
      ) {
        return [];
      }

      return [
        {
          fiscalDate: date,
          revenue,
          grossProfit,
          operatingIncome,
          netIncome,
          eps,
          totalAssets,
          totalLiabilities,
          totalEquity,
          operatingCashFlow,
          freeCashFlow,
          totalDebt: parseNum(balance.totalDebt),
          cashAndEquivalents: parseNum(balance.cashAndCashEquivalents),
          sharesOutstanding: parseNum(income.weightedAverageShsOut),
        },
      ];
    })
    .slice(0, 4);
  if (statements.length === 0) {
    throw new Error(`LSE returned no complete financial statements for ${symbol}`);
  }
  return statements;
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
