import { httpGet } from "../infra/http-client.js";
import { cache, TTL, STALE_LIMIT } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { CompanyOverview, EarningsData, FinancialStatement } from "../types/fundamentals.js";
import type { StockQuote, OHLCV } from "../types/market.js";

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

  try {
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
  } catch (error) {
    const stale = cache.getStale<CompanyOverview>(cacheKey, STALE_LIMIT.FUNDAMENTALS);
    if (stale) return stale.value;
    throw error;
  }
}

export async function getEarnings(
  symbol: string,
  apiKey: string,
): Promise<EarningsData> {
  const cacheKey = `av:earnings:${symbol}`;
  const cached = cache.get<EarningsData>(cacheKey);
  if (cached) return cached;

  try {
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
  } catch (error) {
    const stale = cache.getStale<EarningsData>(cacheKey, STALE_LIMIT.FUNDAMENTALS);
    if (stale) return stale.value;
    throw error;
  }
}

export async function getFinancials(
  symbol: string,
  apiKey: string,
): Promise<FinancialStatement[]> {
  const cacheKey = `av:financials:${symbol}`;
  const cached = cache.get<FinancialStatement[]>(cacheKey);
  if (cached) return cached;

  try {
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
  } catch (error) {
    const stale = cache.getStale<FinancialStatement[]>(cacheKey, STALE_LIMIT.FUNDAMENTALS);
    if (stale) return stale.value;
    throw error;
  }
}

async function fetchStatement<T>(fn: string, symbol: string, apiKey: string): Promise<T> {
  await rateLimiter.acquire("alphavantage");
  const url = buildUrl(fn, { symbol }, apiKey);
  return httpGet<T>(url);
}

export async function getGlobalQuote(
  symbol: string,
  apiKey: string,
): Promise<StockQuote> {
  const cacheKey = `av:globalquote:${symbol}`;
  const cached = cache.get<StockQuote>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("alphavantage");

    const url = buildUrl("GLOBAL_QUOTE", { symbol }, apiKey);
    const data = await httpGet<{ "Global Quote": Record<string, string> }>(url);
    const gq = data["Global Quote"];

    if (!gq || !gq["05. price"]) {
      throw new Error(`Alpha Vantage: No quote data for ${symbol}`);
    }

    const price = parseFloat(gq["05. price"]) || 0;
    const result: StockQuote = {
      symbol: gq["01. symbol"] ?? symbol,
      price,
      change: parseFloat(gq["09. change"]) || 0,
      changePercent: parseFloat(gq["10. change percent"]?.replace("%", "")) || 0,
      open: parseFloat(gq["02. open"]) || 0,
      high: parseFloat(gq["03. high"]) || 0,
      low: parseFloat(gq["04. low"]) || 0,
      previousClose: parseFloat(gq["08. previous close"]) || 0,
      volume: parseInt(gq["06. volume"], 10) || 0,
      marketCap: 0,      // Not available from GLOBAL_QUOTE
      pe: null,           // Not available from GLOBAL_QUOTE
      week52High: 0,      // Not available from GLOBAL_QUOTE
      week52Low: 0,       // Not available from GLOBAL_QUOTE
      timestamp: Date.now(),
    };

    cache.set(cacheKey, result, TTL.QUOTE);
    return result;
  } catch (error) {
    const stale = cache.getStale<StockQuote>(cacheKey, STALE_LIMIT.QUOTE);
    if (stale) return stale.value;
    throw error;
  }
}

export async function getDailyHistory(
  symbol: string,
  apiKey: string,
  range: string = "6mo",
): Promise<OHLCV[]> {
  const cacheKey = `av:daily:${symbol}:${range}`;
  const cached = cache.get<OHLCV[]>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("alphavantage");

    // compact = last 100 data points, full = full 20+ year history
    const daysNeeded = rangeToDays(range);
    const outputsize = daysNeeded > 100 ? "full" : "compact";
    const url = buildUrl("TIME_SERIES_DAILY", { symbol, outputsize }, apiKey);
    const data = await httpGet<{ "Time Series (Daily)": Record<string, Record<string, string>> }>(url);

    const timeSeries = data["Time Series (Daily)"];
    if (!timeSeries) {
      throw new Error(`Alpha Vantage: No daily history for ${symbol}`);
    }

    const ohlcv: OHLCV[] = Object.entries(timeSeries)
      .map(([date, bar]) => ({
        date,
        open: parseFloat(bar["1. open"]) || 0,
        high: parseFloat(bar["2. high"]) || 0,
        low: parseFloat(bar["3. low"]) || 0,
        close: parseFloat(bar["4. close"]) || 0,
        volume: parseInt(bar["5. volume"], 10) || 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-daysNeeded);

    cache.set(cacheKey, ohlcv, TTL.HISTORY);
    return ohlcv;
  } catch (error) {
    const stale = cache.getStale<OHLCV[]>(cacheKey, STALE_LIMIT.HISTORY);
    if (stale) return stale.value;
    throw error;
  }
}

function rangeToDays(range: string): number {
  const map: Record<string, number> = {
    "1d": 1, "5d": 5, "1mo": 22, "3mo": 66, "6mo": 130,
    "1y": 252, "2y": 504, "5y": 1260, "max": 5000,
  };
  return map[range] ?? 130;
}

function parseNum(s: string | undefined): number {
  return parseFloat(s ?? "0") || 0;
}

function parseNullableNum(s: string | undefined): number | null {
  if (!s || s === "None" || s === "-") return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
