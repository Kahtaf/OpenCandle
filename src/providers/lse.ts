import { currentAbortSignal } from "../infra/abort-context.js";
import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import type { FinancialStatement } from "../types/fundamentals.js";
import { lseCacheKey, lseExport } from "./lse-transport.js";
import { ProviderCredentialError } from "./provider-credential-error.js";

export { getLseUsage, LseHttpError } from "./lse-transport.js";

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

function validateLimit(limit: number | undefined): void {
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
    throw new Error("LSE limit must be a positive integer");
}

// OC's history tool accepts equity tickers, including Yahoo's exchange suffixes.
// Do not guess an international listing as a US security when its suffix is unknown.
function equityIdentity(symbol: string): { market: string; symbol: string } {
  const upper = symbol.toUpperCase();
  if (upper.endsWith(".L") || upper.endsWith(".UK"))
    return { market: "uk_stocks", symbol: upper.replace(/\.(?:L|UK)$/, "") };
  if (upper.endsWith(".TO")) return { market: "ca_stocks", symbol: upper.slice(0, -3) };
  if (/^[A-Z0-9]+(?:[.-][A-Z])?$/.test(upper))
    return { market: "us_stocks", symbol: upper.replace(/-([A-Z])$/, ".$1") };
  throw new Error(`LSE history does not support this ticker's market: ${symbol}`);
}

function dateBound(value: string): string {
  const date = value.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date
  )
    throw new Error("LSE date must be a valid YYYY-MM-DD date");
  return date;
}

export async function getLseCandles(
  symbol: string,
  timeframe: LseTimeframe,
  opts: LseCandleOptions = {},
): Promise<LseCandle[]> {
  currentAbortSignal()?.throwIfAborted();
  validateLimit(opts.limit);
  const params = {
    ...equityIdentity(symbol),
    timeframe,
    from: dateBound(opts.start ?? "1900-01-01"),
    to: dateBound(opts.end ?? new Date().toISOString()),
    adjusted: "1",
    format: "csv",
  };
  if (params.from > params.to) throw new Error("LSE start date must precede end date");
  const key = lseCacheKey("candles", {
    ...params,
    order: opts.order ?? "asc",
    limit: String(opts.limit ?? "all"),
  });
  const cached = cache.get<LseCandle[]>(key);
  if (cached) return cached;
  try {
    const raw = await lseExport("/export", params);
    currentAbortSignal()?.throwIfAborted();
    const rows = raw
      .map((row) => {
        const ts = /(?:Z|[+-]\d{2}:\d{2})$/i.test(row.time ?? "")
          ? row.time!
          : `${row.time?.replace(" ", "T")}Z`;
        const values = [row.open, row.high, row.low, row.close, row.volume].map((value) =>
          value?.trim() ? Number(value) : Number.NaN,
        );
        const [open, high, low, close, volume] = values as [number, number, number, number, number];
        if (
          !Number.isFinite(Date.parse(ts)) ||
          !values.every(Number.isFinite) ||
          Math.min(open, high, low, close) <= 0 ||
          high < Math.max(open, close) ||
          low > Math.min(open, close) ||
          volume < 0
        )
          throw new Error("LSE candles response did not contain valid candle rows");
        return {
          ts: new Date(ts).toISOString().replace(".000Z", "Z"),
          symbol,
          open,
          high,
          low,
          close,
          volume,
        };
      })
      .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    if (!rows.length) throw new Error("LSE candles response did not contain valid candle rows");
    if (opts.order === "desc") rows.reverse();
    const result = opts.limit === undefined ? rows : rows.slice(0, opts.limit);
    cache.set(key, result, TTL.CANDLES);
    return result;
  } catch (error) {
    if (currentAbortSignal()?.aborted || error instanceof ProviderCredentialError) throw error;
    const stale = cache.getStale<LseCandle[]>(key, STALE_LIMIT.CANDLES);
    if (stale) return stale.value;
    throw error;
  }
}

export async function getLseFinancialReports(
  symbol: string,
  reportType: "income" | "balance" | "cashflow",
  opts: LseFinancialReportOptions = {},
): Promise<LseFinancialReportRow[]> {
  currentAbortSignal()?.throwIfAborted();
  validateLimit(opts.limit);
  const params = { dataset: "financial_reports", symbol: symbol.toUpperCase(), format: "csv" };
  const key = lseCacheKey("financial_reports", params);
  let rows = cache.get<LseFinancialReportRow[]>(key);
  if (!rows) {
    try {
      rows = await lseExport("/reference/export", params);
      currentAbortSignal()?.throwIfAborted();
      if (
        !rows.length ||
        rows.some(
          (row) =>
            typeof row.symbol !== "string" ||
            row.symbol.toUpperCase() !== params.symbol ||
            typeof row.date !== "string" ||
            !Number.isFinite(Date.parse(row.date)) ||
            typeof row.report_type !== "string" ||
            typeof row.data !== "string",
        )
      )
        throw new Error("LSE financial report export has invalid rows");
      cache.set(key, rows, TTL.FINANCIAL_REPORTS);
    } catch (error) {
      if (currentAbortSignal()?.aborted || error instanceof ProviderCredentialError) throw error;
      const stale = cache.getStale<LseFinancialReportRow[]>(key, STALE_LIMIT.FINANCIAL_REPORTS);
      if (!stale) throw error;
      rows = stale.value;
    }
  }
  const filtered = rows
    .filter(
      (row) =>
        row.report_type === reportType &&
        (opts.period === undefined || row.period === opts.period) &&
        (opts.start === undefined || String(row.date) >= dateBound(opts.start)) &&
        (opts.end === undefined || String(row.date) <= dateBound(opts.end)),
    )
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (opts.order === "desc") filtered.reverse();
  return opts.limit === undefined ? filtered : filtered.slice(0, opts.limit);
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
