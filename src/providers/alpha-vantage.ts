import { httpGet } from "../infra/http-client.js";
import { cache, TTL } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { CompanyOverview, EarningsData, FinancialStatement } from "../types/fundamentals.js";

const BASE_URL = "https://www.alphavantage.co/query";
const MISSING_OVERVIEW_TTL = 15 * 60_000;

function buildUrl(fn: string, params: Record<string, string>, apiKey: string): string {
  const qs = new URLSearchParams({ function: fn, ...params, apikey: apiKey });
  return `${BASE_URL}?${qs}`;
}

export async function getOverview(
  symbol: string,
  apiKey: string,
): Promise<CompanyOverview> {
  const cacheKey = `av:overview:${symbol}`;
  const missingCacheKey = `${cacheKey}:missing`;
  const cached = cache.get<CompanyOverview>(cacheKey);
  if (cached) return cached;
  if (cache.get<string>(missingCacheKey)) {
    throw new Error(`Alpha Vantage: No data found for ${symbol}`);
  }

  await rateLimiter.acquire("alphavantage");

  const url = buildUrl("OVERVIEW", { symbol }, apiKey);
  const data = await httpGet<Record<string, string>>(url);

  if (!data.Symbol) {
    cache.set(missingCacheKey, "missing", MISSING_OVERVIEW_TTL);
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
    avgVolume: 0, // Alpha Vantage OVERVIEW does not expose average volume
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

  // Fetch sequentially to respect Alpha Vantage rate limits (5 req/min free tier)
  const incomeData = await fetchStatement<{ annualReports: any[] }>("INCOME_STATEMENT", symbol, apiKey);
  const balanceData = await fetchStatement<{ annualReports: any[] }>("BALANCE_SHEET", symbol, apiKey);
  const cashFlowData = await fetchStatement<{ annualReports: any[] }>("CASH_FLOW", symbol, apiKey);

  const incomeReports = incomeData.annualReports ?? [];
  const balanceReports = balanceData.annualReports ?? [];
  const cashFlowReports = cashFlowData.annualReports ?? [];

  // Index balance sheet and cash flow by fiscal date for merging
  const balanceByDate = new Map(
    balanceReports.map((r: any) => [r.fiscalDateEnding, r]),
  );
  const cashFlowByDate = new Map(
    cashFlowReports.map((r: any) => [r.fiscalDateEnding, r]),
  );

  const statements = incomeReports.slice(0, 4).map((r: any) => {
    const balance = balanceByDate.get(r.fiscalDateEnding) ?? {};
    const cf = cashFlowByDate.get(r.fiscalDateEnding) ?? {};
    const opCashFlow = parseNum(cf.operatingCashflow);
    const capex = parseNum(cf.capitalExpenditures);

    const totalDebt = parseNum(balance.shortLongTermDebtTotal);
    const cash = parseNum(balance.cashAndCashEquivalentsAtCarryingValue);

    return {
      fiscalDate: r.fiscalDateEnding,
      revenue: parseNum(r.totalRevenue),
      grossProfit: parseNum(r.grossProfit),
      operatingIncome: parseNum(r.operatingIncome),
      netIncome: parseNum(r.netIncome),
      eps: parseFloat(r.reportedEPS) || 0,
      totalAssets: parseNum(balance.totalAssets),
      totalLiabilities: parseNum(balance.totalLiabilities),
      totalEquity: parseNum(balance.totalShareholderEquity),
      operatingCashFlow: opCashFlow,
      freeCashFlow: opCashFlow - capex,
      totalDebt: totalDebt || undefined,
      cashAndEquivalents: cash || undefined,
    };
  });

  cache.set(cacheKey, statements, TTL.FUNDAMENTALS);
  return statements;
}

async function fetchStatement<T>(fn: string, symbol: string, apiKey: string): Promise<T> {
  await rateLimiter.acquire("alphavantage");
  const url = buildUrl(fn, { symbol }, apiKey);
  return httpGet<T>(url);
}

function parseNum(s: string | undefined): number {
  return parseFloat(s ?? "0") || 0;
}

function parseNullableNum(s: string | undefined): number | null {
  if (!s || s === "None" || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
