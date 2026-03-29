import { httpGet } from "../infra/http-client.js";
import { cache, TTL } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { CompanyOverview, EarningsData, FinancialStatement } from "../types/fundamentals.js";

const BASE_URL = "https://www.alphavantage.co/query";

function buildUrl(fn: string, params: Record<string, string>, apiKey: string): string {
  const qs = new URLSearchParams({ function: fn, ...params, apikey: apiKey });
  return `${BASE_URL}?${qs}`;
}

export async function getOverview(
  symbol: string,
  apiKey: string,
): Promise<CompanyOverview> {
  const cacheKey = `av:overview:${symbol}`;
  const cached = cache.get<CompanyOverview>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("alphavantage");

  const url = buildUrl("OVERVIEW", { symbol }, apiKey);
  const data = await httpGet<Record<string, string>>(url);

  if (!data.Symbol) {
    throw new Error(`Alpha Vantage: No data found for ${symbol}`);
  }

  const result: CompanyOverview = {
    symbol: data.Symbol,
    name: data.Name,
    description: data.Description,
    exchange: data.Exchange,
    sector: data.Sector,
    industry: data.Industry,
    marketCap: parseNum(data.MarketCapitalization),
    pe: parseNullableNum(data.PERatio),
    forwardPe: parseNullableNum(data.ForwardPE),
    eps: parseNullableNum(data.EPS),
    dividendYield: parseNullableNum(data.DividendYield),
    beta: parseNullableNum(data.Beta),
    week52High: parseNum(data["52WeekHigh"]),
    week52Low: parseNum(data["52WeekLow"]),
    avgVolume: parseNum(data["50DayMovingAverage"]),
    profitMargin: parseNullableNum(data.ProfitMargin),
    revenueGrowth: parseNullableNum(data.QuarterlyRevenueGrowthYOY),
  };

  cache.set(cacheKey, result, TTL.FUNDAMENTALS);
  return result;
}

export async function getEarnings(
  symbol: string,
  apiKey: string,
): Promise<EarningsData> {
  const cacheKey = `av:earnings:${symbol}`;
  const cached = cache.get<EarningsData>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("alphavantage");

  const url = buildUrl("EARNINGS", { symbol }, apiKey);
  const data = await httpGet<{ quarterlyEarnings: any[] }>(url);

  const quarterly = (data.quarterlyEarnings ?? []).slice(0, 8).map((e: any) => ({
    date: e.fiscalDateEnding,
    reportedEPS: parseFloat(e.reportedEPS) || 0,
    estimatedEPS: parseFloat(e.estimatedEPS) || 0,
    surprise: parseFloat(e.surprise) || 0,
    surprisePercent: parseFloat(e.surprisePercentage) || 0,
  }));

  const result: EarningsData = { symbol, quarterly };
  cache.set(cacheKey, result, TTL.FUNDAMENTALS);
  return result;
}

export async function getFinancials(
  symbol: string,
  apiKey: string,
): Promise<FinancialStatement[]> {
  const cacheKey = `av:financials:${symbol}`;
  const cached = cache.get<FinancialStatement[]>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("alphavantage");

  // Fetch income statement (Alpha Vantage provides annual reports)
  const url = buildUrl("INCOME_STATEMENT", { symbol }, apiKey);
  const data = await httpGet<{ annualReports: any[] }>(url);

  const statements = (data.annualReports ?? []).slice(0, 4).map((r: any) => ({
    fiscalDate: r.fiscalDateEnding,
    revenue: parseNum(r.totalRevenue),
    grossProfit: parseNum(r.grossProfit),
    operatingIncome: parseNum(r.operatingIncome),
    netIncome: parseNum(r.netIncome),
    eps: parseFloat(r.reportedEPS) || 0,
    totalAssets: 0, // Would need separate BALANCE_SHEET call
    totalLiabilities: 0,
    totalEquity: 0,
    operatingCashFlow: 0, // Would need separate CASH_FLOW call
    freeCashFlow: 0,
  }));

  cache.set(cacheKey, statements, TTL.FUNDAMENTALS);
  return statements;
}

function parseNum(s: string | undefined): number {
  return parseFloat(s ?? "0") || 0;
}

function parseNullableNum(s: string | undefined): number | null {
  if (!s || s === "None" || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
