import YahooFinance from "yahoo-finance2";
import type { OptionsResult as YahooFinance2OptionsResult } from "yahoo-finance2/modules/options";
import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { HttpError, httpGet } from "../infra/http-client.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import { computeGreeks } from "../tools/options/greeks.js";
import type { CompanyOverview, FinancialStatement } from "../types/fundamentals.js";
import type { OHLCV, StockQuote } from "../types/market.js";
import type {
  OptionContract,
  OptionsChain,
  OptionsMarketSession,
  OptionsQuoteStatus,
} from "../types/options.js";
import type { FundHoldings } from "../types/portfolio.js";
import { InvalidSymbolError } from "./errors.js";

const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";
const QUOTE_SUMMARY_URL = "https://query1.finance.yahoo.com/v10/finance/quoteSummary";
const STALE_QUOTE_MAX_RETRY_AFTER_MS = 1_000;
const EXTENDED_QUOTE_TIMEOUT_MS = 3_000;

let yahooFinance2Client: InstanceType<typeof YahooFinance> | undefined;

function getYahooFinance2Client(): InstanceType<typeof YahooFinance> {
  yahooFinance2Client ??= new YahooFinance({
    suppressNotices: ["yahooSurvey", "ripHistorical"],
  });
  return yahooFinance2Client;
}

type YahooNumber = number | { raw?: number; fmt?: string };

interface YahooChartResponse {
  chart: {
    result: Array<{
      meta: Record<string, any>;
      timestamp: number[];
      indicators: {
        quote: Array<{
          open: number[];
          high: number[];
          low: number[];
          close: number[];
          volume: number[];
        }>;
        adjclose?: Array<{ adjclose: number[] }>;
      };
    }>;
    error?: { code: string; description: string };
  };
}

interface YahooQuoteSummaryResponse {
  quoteSummary: {
    result?: Array<YahooQuoteSummaryResult>;
    error?: { code?: string; description?: string } | null;
  };
}

interface YahooQuoteSummaryResult {
  price?: {
    symbol?: string;
    shortName?: string;
    longName?: string;
    exchangeName?: string;
    marketCap?: YahooNumber;
  };
  assetProfile?: {
    longBusinessSummary?: string;
    sector?: string;
    industry?: string;
  };
  summaryProfile?: {
    longBusinessSummary?: string;
    sector?: string;
    industry?: string;
  };
  summaryDetail?: {
    trailingPE?: YahooNumber;
    forwardPE?: YahooNumber;
    dividendYield?: YahooNumber;
    beta?: YahooNumber;
    fiftyTwoWeekHigh?: YahooNumber;
    fiftyTwoWeekLow?: YahooNumber;
    averageVolume?: YahooNumber;
  };
  defaultKeyStatistics?: {
    trailingEps?: YahooNumber;
    forwardEps?: YahooNumber;
    beta?: YahooNumber;
  };
  financialData?: {
    profitMargins?: YahooNumber;
    revenueGrowth?: YahooNumber;
    totalRevenue?: YahooNumber;
  };
  topHoldings?: {
    holdings?: Array<{
      symbol?: string;
      holdingName?: string;
      holdingPercent?: YahooNumber;
    }>;
    equityHoldings?: {
      sectorWeightings?: Array<Record<string, YahooNumber>>;
    };
  };
}

interface YahooFinance2Quote {
  marketState?: string;
  extendedMarketPrice?: number;
  extendedMarketChange?: number;
  extendedMarketChangePercent?: number;
  extendedMarketTime?: Date | string | number;
  preMarketPrice?: number;
  preMarketChange?: number;
  preMarketChangePercent?: number;
  preMarketTime?: Date | string | number;
  postMarketPrice?: number;
  postMarketChange?: number;
  postMarketChangePercent?: number;
  postMarketTime?: Date | string | number;
}

export async function getYahooCompanyOverview(symbol: string): Promise<CompanyOverview> {
  const normalizedSymbol = symbol.toUpperCase();
  const cacheKey = `yahoo:overview:${normalizedSymbol}`;
  const cached = cache.get<CompanyOverview>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("yahoo");
    const result = await getYahooCompanySummary(normalizedSymbol);
    if (!result?.price?.symbol) {
      throw new Error(`Yahoo Finance: no company fundamentals returned for ${normalizedSymbol}`);
    }

    const profile = result.assetProfile ?? result.summaryProfile;
    const overview: CompanyOverview = {
      symbol: result.price.symbol.toUpperCase(),
      name: result.price.longName ?? result.price.shortName ?? result.price.symbol,
      description: profile?.longBusinessSummary ?? "",
      exchange: result.price.exchangeName ?? "",
      sector: profile?.sector ?? "",
      industry: profile?.industry ?? "",
      marketCap: yahooNumber(result.price.marketCap) ?? 0,
      pe: yahooNullableNumber(result.summaryDetail?.trailingPE),
      forwardPe: yahooNullableNumber(result.summaryDetail?.forwardPE),
      eps:
        yahooNullableNumber(result.defaultKeyStatistics?.trailingEps) ??
        yahooNullableNumber(result.defaultKeyStatistics?.forwardEps),
      dividendYield: yahooNullableNumber(result.summaryDetail?.dividendYield),
      beta:
        yahooNullableNumber(result.summaryDetail?.beta) ??
        yahooNullableNumber(result.defaultKeyStatistics?.beta),
      week52High: yahooNumber(result.summaryDetail?.fiftyTwoWeekHigh) ?? 0,
      week52Low: yahooNumber(result.summaryDetail?.fiftyTwoWeekLow) ?? 0,
      avgVolume: yahooNumber(result.summaryDetail?.averageVolume) ?? 0,
      profitMargin: yahooNullableNumber(result.financialData?.profitMargins),
      revenueGrowth: yahooNullableNumber(result.financialData?.revenueGrowth),
    };

    cache.set(cacheKey, overview, TTL.FUNDAMENTALS);
    return overview;
  } catch (error) {
    const stale = cache.getStale<CompanyOverview>(cacheKey, STALE_LIMIT.FUNDAMENTALS);
    if (stale) return stale.value;
    throw error;
  }
}

export async function getQuote(symbol: string): Promise<StockQuote> {
  const cacheKey = `yahoo:quote:${symbol}`;
  const cached = cache.get<StockQuote>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("yahoo");

    const url = `${BASE_URL}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const data = await httpGet<YahooChartResponse>(url, {
      headers: { "User-Agent": "OpenCandle/1.0" },
      maxRetryAfterMs: STALE_QUOTE_MAX_RETRY_AFTER_MS,
    });

    if (data.chart.error) {
      throw new Error(`Yahoo Finance: ${data.chart.error.description}`);
    }

    const result = data.chart.result[0];
    const meta = result.meta;
    const indicators = result.indicators.quote[0];

    const price = meta.regularMarketPrice ?? 0;
    const prevClose = meta.chartPreviousClose ?? meta.previousClose ?? price;
    const change = price - prevClose;
    const changePercent = prevClose !== 0 ? (change / prevClose) * 100 : 0;

    // Open price: try meta first, fall back to indicators
    const open = meta.regularMarketOpen ?? indicators?.open?.[0] ?? price;

    const quote: StockQuote = {
      symbol: meta.symbol,
      name:
        typeof meta.longName === "string" && meta.longName.trim() !== ""
          ? meta.longName.trim()
          : typeof meta.shortName === "string" && meta.shortName.trim() !== ""
            ? meta.shortName.trim()
            : undefined,
      price,
      change,
      changePercent,
      open,
      high: meta.regularMarketDayHigh ?? indicators?.high?.[0] ?? price,
      low: meta.regularMarketDayLow ?? indicators?.low?.[0] ?? price,
      previousClose: prevClose,
      volume: meta.regularMarketVolume ?? 0,
      marketCap: meta.marketCap ?? 0,
      pe: null, // Not in chart endpoint
      week52High: meta.fiftyTwoWeekHigh ?? 0,
      week52Low: meta.fiftyTwoWeekLow ?? 0,
      timestamp: Date.now(),
      asOf: yahooMarketTimeToIso(meta.regularMarketTime),
      currency:
        typeof meta.currency === "string" && meta.currency.trim() !== ""
          ? meta.currency.trim().toUpperCase()
          : null,
    };

    if (isZeroResultQuote(quote)) {
      throw new InvalidSymbolError(symbol.toUpperCase(), "yahoo");
    }

    const enrichedQuote = await enrichQuoteWithExtendedHours(symbol, quote);
    cache.set(cacheKey, enrichedQuote, TTL.QUOTE);
    return enrichedQuote;
  } catch (error) {
    const stale = cache.getStale<StockQuote>(cacheKey, STALE_LIMIT.QUOTE);
    if (stale) return stale.value;
    throw error;
  }
}

async function enrichQuoteWithExtendedHours(
  symbol: string,
  quote: StockQuote,
): Promise<StockQuote> {
  try {
    await rateLimiter.acquire("yahoo");
    const yahooQuote = (await withTimeout(
      getYahooFinance2Client().quote(symbol),
      EXTENDED_QUOTE_TIMEOUT_MS,
    )) as YahooFinance2Quote | null;
    if (!yahooQuote) return quote;

    const marketState = normalizeMarketState(yahooQuote.marketState);
    if (!marketState) return quote;
    const withMarketState: StockQuote = { ...quote, marketState };
    if (marketState !== "PRE" && marketState !== "POST") return withMarketState;

    const extended =
      marketState === "PRE" ? preMarketFields(yahooQuote) : postMarketFields(yahooQuote);
    if (!Number.isFinite(extended.price)) return withMarketState;

    return {
      ...withMarketState,
      extendedPrice: extended.price,
      extendedChange: extended.change,
      extendedChangePercent: extended.changePercent,
      extendedAsOf: toIsoString(extended.time),
    };
  } catch {
    return quote;
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Yahoo extended-hours lookup timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalizeMarketState(value: string | undefined): StockQuote["marketState"] | undefined {
  if (value === "PRE" || value === "PREPRE") return "PRE";
  if (value === "POST" || value === "POSTPOST") return "POST";
  if (value === "REGULAR" || value === "CLOSED") return value;
  return undefined;
}

function preMarketFields(quote: YahooFinance2Quote) {
  return {
    price: quote.extendedMarketPrice ?? quote.preMarketPrice,
    change: quote.extendedMarketChange ?? quote.preMarketChange,
    changePercent: quote.extendedMarketChangePercent ?? quote.preMarketChangePercent,
    time: quote.extendedMarketTime ?? quote.preMarketTime,
  };
}

function postMarketFields(quote: YahooFinance2Quote) {
  return {
    price: quote.extendedMarketPrice ?? quote.postMarketPrice,
    change: quote.extendedMarketChange ?? quote.postMarketChange,
    changePercent: quote.extendedMarketChangePercent ?? quote.postMarketChangePercent,
    time: quote.extendedMarketTime ?? quote.postMarketTime,
  };
}

function toIsoString(value: Date | string | number | undefined): string | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  const timestamp = typeof value === "number" ? value : Date.parse(value ?? "");
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
}

type YahooFundamentalsRow = {
  date?: Date | string | number;
  totalRevenue?: number;
  annualTotalRevenue?: number;
  grossProfit?: number;
  annualGrossProfit?: number;
  operatingIncome?: number;
  annualOperatingIncome?: number;
  netIncome?: number;
  annualNetIncome?: number;
  netIncomeCommonStockholders?: number;
  annualNetIncomeCommonStockholders?: number;
  basicEPS?: number;
  annualBasicEPS?: number;
  dilutedEPS?: number;
  annualDilutedEPS?: number;
  totalAssets?: number;
  annualTotalAssets?: number;
  totalLiabilitiesNetMinorityInterest?: number;
  annualTotalLiabilitiesNetMinorityInterest?: number;
  totalLiabilities?: number;
  annualTotalLiabilities?: number;
  stockholdersEquity?: number;
  annualStockholdersEquity?: number;
  commonStockEquity?: number;
  annualCommonStockEquity?: number;
  cashFlowFromContinuingOperatingActivities?: number;
  annualCashFlowFromContinuingOperatingActivities?: number;
  operatingCashFlow?: number;
  annualOperatingCashFlow?: number;
  freeCashFlow?: number;
  annualFreeCashFlow?: number;
  capitalExpenditure?: number;
  annualCapitalExpenditure?: number;
  capitalExpenditures?: number;
  annualCapitalExpenditures?: number;
  totalDebt?: number;
  annualTotalDebt?: number;
  cashAndCashEquivalents?: number;
  annualCashAndCashEquivalents?: number;
  ordinarySharesNumber?: number;
  annualOrdinarySharesNumber?: number;
  shareIssued?: number;
  annualShareIssued?: number;
  dilutedAverageShares?: number;
  annualDilutedAverageShares?: number;
  basicAverageShares?: number;
  annualBasicAverageShares?: number;
};

export async function getYahooFinancials(symbol: string): Promise<FinancialStatement[]> {
  const normalizedSymbol = symbol.toUpperCase();
  const cacheKey = `yahoo:financials:${normalizedSymbol}`;
  const cached = cache.get<FinancialStatement[]>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("yahoo");

    const period1 = new Date();
    period1.setUTCFullYear(period1.getUTCFullYear() - 6);
    const rows = (await getYahooFinance2Client().fundamentalsTimeSeries(
      normalizedSymbol,
      {
        period1,
        period2: new Date(),
        type: "annual",
        module: "all",
      },
      { validateResult: false },
    )) as YahooFundamentalsRow[];

    const statements = rows
      .map((row) => yahooFundamentalsRowToStatement(row))
      .filter((statement): statement is FinancialStatement => statement !== null)
      .sort((a, b) => b.fiscalDate.localeCompare(a.fiscalDate))
      .slice(0, 4);

    if (statements.length === 0) {
      throw new Error(`Yahoo Finance: no financial statements returned for ${normalizedSymbol}`);
    }

    cache.set(cacheKey, statements, TTL.FUNDAMENTALS);
    return statements;
  } catch (error) {
    const stale = cache.getStale<FinancialStatement[]>(cacheKey, STALE_LIMIT.FUNDAMENTALS);
    if (stale) return stale.value;
    throw error;
  }
}

function yahooFundamentalsRowToStatement(row: YahooFundamentalsRow): FinancialStatement | null {
  const fiscalDate = normalizeYahooDate(row.date);
  if (!fiscalDate) return null;

  const operatingCashFlowValue =
    row.annualCashFlowFromContinuingOperatingActivities ??
    row.cashFlowFromContinuingOperatingActivities ??
    row.annualOperatingCashFlow ??
    row.operatingCashFlow;
  const capitalExpenditureValue =
    row.annualCapitalExpenditure ??
    row.capitalExpenditure ??
    row.annualCapitalExpenditures ??
    row.capitalExpenditures;
  const operatingCashFlow = operatingCashFlowValue ?? 0;
  const capitalExpenditure = capitalExpenditureValue ?? 0;
  const freeCashFlow =
    row.annualFreeCashFlow ??
    row.freeCashFlow ??
    (operatingCashFlowValue !== undefined && capitalExpenditureValue !== undefined
      ? operatingCashFlow + capitalExpenditure
      : 0);

  return {
    fiscalDate,
    revenue: row.annualTotalRevenue ?? row.totalRevenue ?? 0,
    grossProfit: row.annualGrossProfit ?? row.grossProfit ?? 0,
    operatingIncome: row.annualOperatingIncome ?? row.operatingIncome ?? 0,
    netIncome:
      row.annualNetIncome ??
      row.netIncome ??
      row.annualNetIncomeCommonStockholders ??
      row.netIncomeCommonStockholders ??
      0,
    eps: row.annualDilutedEPS ?? row.dilutedEPS ?? row.annualBasicEPS ?? row.basicEPS ?? 0,
    totalAssets: row.annualTotalAssets ?? row.totalAssets ?? 0,
    totalLiabilities:
      row.annualTotalLiabilitiesNetMinorityInterest ??
      row.totalLiabilitiesNetMinorityInterest ??
      row.annualTotalLiabilities ??
      row.totalLiabilities ??
      0,
    totalEquity:
      row.annualStockholdersEquity ??
      row.stockholdersEquity ??
      row.annualCommonStockEquity ??
      row.commonStockEquity ??
      0,
    operatingCashFlow,
    freeCashFlow,
    totalDebt: row.annualTotalDebt ?? row.totalDebt,
    cashAndEquivalents: row.annualCashAndCashEquivalents ?? row.cashAndCashEquivalents,
    sharesOutstanding:
      row.annualOrdinarySharesNumber ??
      row.ordinarySharesNumber ??
      row.annualShareIssued ??
      row.shareIssued ??
      row.annualDilutedAverageShares ??
      row.dilutedAverageShares ??
      row.annualBasicAverageShares ??
      row.basicAverageShares,
  };
}

function normalizeYahooDate(value: Date | string | number | undefined): string | null {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    const timestampMs = Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(timestampMs);
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function isZeroResultQuote(quote: StockQuote): boolean {
  return (
    quote.price === 0 &&
    quote.volume === 0 &&
    quote.week52High === 0 &&
    quote.week52Low === 0 &&
    quote.marketCap === 0
  );
}

export async function getHistory(
  symbol: string,
  range: string = "6mo",
  interval: string = "1d",
): Promise<OHLCV[]> {
  const cacheKey = `yahoo:history:${symbol}:${range}:${interval}`;
  const cached = cache.get<OHLCV[]>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("yahoo");

    const url = `${BASE_URL}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
    const data = await httpGet<YahooChartResponse>(url, {
      headers: { "User-Agent": "OpenCandle/1.0" },
    });

    if (data.chart.error) {
      throw new Error(`Yahoo Finance: ${data.chart.error.description}`);
    }

    const result = data.chart.result[0];
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];

    const ohlcv: OHLCV[] = timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().split("T")[0],
        timestamp: ts,
        open: quotes.open[i],
        high: quotes.high[i],
        low: quotes.low[i],
        close: quotes.close[i],
        volume: quotes.volume[i],
      }))
      .filter((bar) => bar.open != null && bar.close != null);

    cache.set(cacheKey, ohlcv, TTL.HISTORY);
    return ohlcv;
  } catch (error) {
    const stale = cache.getStale<OHLCV[]>(cacheKey, STALE_LIMIT.HISTORY);
    if (stale) return stale.value;
    throw error;
  }
}

export async function getFundHoldings(symbol: string): Promise<FundHoldings> {
  const normalizedSymbol = symbol.toUpperCase();
  const cacheKey = `yahoo:fund-holdings:${normalizedSymbol}`;
  const cached = cache.get<FundHoldings>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("yahoo");

    const data = await getFundHoldingsSummary(normalizedSymbol);
    const result = data.quoteSummary.result?.[0];
    if (data.quoteSummary.error) {
      throw new Error(
        `Yahoo Finance: ${data.quoteSummary.error.description ?? data.quoteSummary.error.code ?? "quoteSummary error"}`,
      );
    }
    if (!result?.topHoldings?.holdings?.length) {
      throw new Error(`Yahoo Finance: no fund holdings returned for ${normalizedSymbol}`);
    }

    const holdings: FundHoldings = {
      symbol: result.price?.symbol?.toUpperCase() ?? normalizedSymbol,
      name: result.price?.shortName ?? result.price?.longName,
      provider: "yahoo",
      holdings: result.topHoldings.holdings.flatMap((holding) => {
        const holdingSymbol = holding.symbol?.trim().toUpperCase();
        const weight = normalizeHoldingWeight(holding.holdingPercent);
        if (!holdingSymbol || weight === undefined) return [];
        return [
          {
            symbol: holdingSymbol,
            name: holding.holdingName?.trim() || holdingSymbol,
            weight,
          },
        ];
      }),
      sectorWeights: normalizeSectorWeights(result.topHoldings.equityHoldings?.sectorWeightings),
    };
    if (holdings.holdings.length === 0) {
      throw new Error(`Yahoo Finance: no weighted fund holdings returned for ${normalizedSymbol}`);
    }

    cache.set(cacheKey, holdings, TTL.FUNDAMENTALS);
    return holdings;
  } catch (error) {
    const stale = cache.getStale<FundHoldings>(cacheKey, STALE_LIMIT.FUNDAMENTALS);
    if (stale) return stale.value;
    throw error;
  }
}

async function getFundHoldingsSummary(symbol: string): Promise<YahooQuoteSummaryResponse> {
  return getYahooQuoteSummary(symbol, "price,topHoldings");
}

async function getYahooCompanySummary(symbol: string): Promise<YahooQuoteSummaryResult> {
  const modules = [
    "price",
    "assetProfile",
    "summaryProfile",
    "summaryDetail",
    "defaultKeyStatistics",
    "financialData",
  ] as const;
  try {
    return (await getYahooFinance2Client().quoteSummary(
      symbol,
      { modules: [...modules] },
      { validateResult: false },
    )) as YahooQuoteSummaryResult;
  } catch (_error) {
    const data = await getYahooQuoteSummary(symbol, modules.join(","));
    if (data.quoteSummary.error) {
      throw new Error(
        `Yahoo Finance: ${data.quoteSummary.error.description ?? data.quoteSummary.error.code ?? "quoteSummary error"}`,
      );
    }
    return data.quoteSummary.result?.[0] ?? {};
  }
}

async function getYahooQuoteSummary(
  symbol: string,
  modules: string,
): Promise<YahooQuoteSummaryResponse> {
  try {
    return await fetchYahooQuoteSummary(symbol, modules);
  } catch (error) {
    if (!isYahooAuthError(error)) throw error;
    return fetchYahooQuoteSummaryWithCrumb(symbol, modules);
  }
}

async function fetchYahooQuoteSummary(
  symbol: string,
  modules: string,
): Promise<YahooQuoteSummaryResponse> {
  const encodedModules = encodeURIComponent(modules);
  const url = `${QUOTE_SUMMARY_URL}/${encodeURIComponent(symbol)}?modules=${encodedModules}`;
  return httpGet<YahooQuoteSummaryResponse>(url, {
    headers: { "User-Agent": "OpenCandle/1.0" },
  });
}

async function fetchYahooQuoteSummaryWithCrumb(
  symbol: string,
  modules: string,
): Promise<YahooQuoteSummaryResponse> {
  const encodedModules = encodeURIComponent(modules);
  const { crumb, cookie } = await getYahooCrumb();
  const url = `${QUOTE_SUMMARY_URL}/${encodeURIComponent(symbol)}?modules=${encodedModules}&crumb=${encodeURIComponent(crumb)}`;
  try {
    return await httpGet<YahooQuoteSummaryResponse>(url, {
      headers: { "User-Agent": BROWSER_UA, Cookie: cookie },
    });
  } catch (error) {
    if (!isYahooAuthError(error)) throw error;
    clearCrumbCache();
    const fresh = await getYahooCrumb();
    const retryUrl = `${QUOTE_SUMMARY_URL}/${encodeURIComponent(symbol)}?modules=${encodedModules}&crumb=${encodeURIComponent(fresh.crumb)}`;
    return httpGet<YahooQuoteSummaryResponse>(retryUrl, {
      headers: { "User-Agent": BROWSER_UA, Cookie: fresh.cookie },
    });
  }
}

function isYahooAuthError(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 401 || error.status === 429);
}

function normalizeHoldingWeight(value: YahooNumber | undefined): number | undefined {
  const numeric = yahooNumber(value);
  if (numeric === undefined || !Number.isFinite(numeric) || numeric <= 0) return undefined;
  return numeric > 1 ? roundWeight(numeric / 100) : roundWeight(numeric);
}

function yahooNumber(value: YahooNumber | undefined): number | undefined {
  const numeric = typeof value === "number" ? value : value?.raw;
  return numeric !== undefined && Number.isFinite(numeric) ? numeric : undefined;
}

function yahooNullableNumber(value: YahooNumber | undefined): number | null {
  return yahooNumber(value) ?? null;
}

function normalizeSectorWeights(
  sectors: Array<Record<string, YahooNumber>> | undefined,
): Record<string, number> | undefined {
  if (!sectors?.length) return undefined;
  const weights: Record<string, number> = {};
  for (const sector of sectors) {
    for (const [name, rawWeight] of Object.entries(sector)) {
      const weight = normalizeHoldingWeight(rawWeight);
      if (weight !== undefined) weights[name] = weight;
    }
  }
  return Object.keys(weights).length > 0 ? weights : undefined;
}

function roundWeight(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

// --- Options Chain (v7 API with crumb+cookie auth) ---

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const YAHOO_RAW_FETCH_TIMEOUT_MS = 10_000;

let cachedCrumb: { crumb: string; cookie: string; expiresAt: number } | null = null;

export function clearCrumbCache(): void {
  cachedCrumb = null;
}

export async function getYahooCrumb(): Promise<{ crumb: string; cookie: string }> {
  if (cachedCrumb && Date.now() < cachedCrumb.expiresAt) {
    return { crumb: cachedCrumb.crumb, cookie: cachedCrumb.cookie };
  }

  // Step 1: Hit fc.yahoo.com to get a session cookie
  const cookieRes = await fetch("https://fc.yahoo.com/t", {
    headers: { "User-Agent": BROWSER_UA },
    signal: yahooRawFetchSignal(),
  });
  const setCookie =
    cookieRes.headers.get("set-cookie") ??
    cookieRes.headers.get("x-opencandle-upstream-set-cookie") ??
    "";
  const cookie = setCookie.split(";")[0]; // Extract just the cookie value
  if (!cookie) {
    if (!cookieRes.ok) {
      throw new Error(
        `Yahoo crumb cookie request failed: HTTP ${cookieRes.status} ${cookieRes.statusText}`.trim(),
      );
    }
    throw new Error("Yahoo crumb cookie request did not return a session cookie");
  }

  // Step 2: Use the cookie to get a crumb
  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": BROWSER_UA, Cookie: cookie },
    signal: yahooRawFetchSignal(),
  });
  if (!crumbRes.ok) {
    throw new Error(
      `Yahoo crumb request failed: HTTP ${crumbRes.status} ${crumbRes.statusText}`.trim(),
    );
  }
  const crumb = (await crumbRes.text()).trim();

  if (!crumb || crumb.includes("Unauthorized")) {
    throw new Error("Failed to acquire Yahoo Finance crumb");
  }

  cachedCrumb = { crumb, cookie, expiresAt: Date.now() + TTL.CRUMB };
  return { crumb, cookie };
}

interface YahooOptionsResponse {
  optionChain: {
    result: Array<{
      underlyingSymbol: string;
      expirationDates: number[];
      strikes: number[];
      quote: Record<string, any>;
      options: Array<{
        expirationDate: number;
        calls: any[];
        puts: any[];
      }>;
    }>;
    error?: any;
  };
}

export async function getOptionsChain(symbol: string, expiration?: number): Promise<OptionsChain> {
  const cacheKey = `yahoo:options:${symbol}:${expiration ?? "nearest"}`;
  const cached = cache.get<OptionsChain>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("yahoo");

  const dateParam = expiration ? `&date=${expiration}` : "";

  let res: Response | null = null;
  let fetchError: unknown;
  try {
    const { crumb, cookie } = await getYahooCrumb();
    const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}${dateParam}`;
    res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Cookie: cookie },
      signal: yahooRawFetchSignal(),
    });
  } catch (error) {
    fetchError = error;
  }

  // On 401 or 429, refresh crumb and retry once
  if (res?.status === 401 || res?.status === 429) {
    try {
      clearCrumbCache();
      const fresh = await getYahooCrumb();
      const retryUrl = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(fresh.crumb)}${dateParam}`;
      res = await fetch(retryUrl, {
        headers: { "User-Agent": BROWSER_UA, Cookie: fresh.cookie },
        signal: yahooRawFetchSignal(),
      });
    } catch (error) {
      fetchError = error;
      res = null;
    }
  }

  // If still failing, fall back to stealth browser (bypasses TLS fingerprinting)
  if (!res?.ok) {
    let browserError: unknown;
    try {
      const fallbackData = await fetchOptionsViaYahooFinance2(symbol, expiration);
      if (fallbackData) {
        const chain = parseOptionsResponse(fallbackData);
        cache.set(cacheKey, chain, TTL.OPTIONS_CHAIN);
        return chain;
      }
    } catch (error) {
      browserError = error;
    }
    // All fetches failed — try stale cache before giving up
    const stale = cache.getStale<OptionsChain>(cacheKey, STALE_LIMIT.OPTIONS_CHAIN);
    if (stale) return stale.value;
    if (res) {
      const message = `Yahoo Finance options: HTTP ${res.status}`;
      if (browserError instanceof Error) {
        throw new Error(`${message}; yahoo-finance2 fallback failed: ${browserError.message}`);
      }
      throw new Error(message);
    }
    if (browserError instanceof Error) {
      const message =
        fetchError instanceof Error ? fetchError.message : "Yahoo Finance options: fetch failed";
      throw new Error(`${message}; yahoo-finance2 fallback failed: ${browserError.message}`);
    }
    throw fetchError instanceof Error
      ? fetchError
      : new Error("Yahoo Finance options: fetch failed");
  }

  const data: YahooOptionsResponse = await res.json();
  const chain = parseOptionsResponse(data);
  cache.set(cacheKey, chain, TTL.OPTIONS_CHAIN);
  return chain;
}

function yahooRawFetchSignal(): AbortSignal {
  return AbortSignal.timeout(YAHOO_RAW_FETCH_TIMEOUT_MS);
}

/**
 * Compute time to expiry in years from a Yahoo expiration timestamp (midnight UTC).
 * US equity options expire at 4:00 PM ET. During EDT that is 20:00 UTC.
 * We use 21:00 UTC (4 PM EST / 5 PM EDT) as a conservative close offset
 * and apply a floor of ~1 hour to prevent numerical instability near expiry.
 */
export function computeTimeToExpiry(expirationTs: number, nowMs: number = Date.now()): number {
  const MARKET_CLOSE_OFFSET_S = 21 * 3600; // 21:00 UTC ≈ 4 PM ET
  const MIN_TIME_YEARS = 1 / (365 * 24); // ~1 hour floor
  const SECONDS_PER_YEAR = 365 * 24 * 3600;

  const expiryCloseTs = expirationTs + MARKET_CLOSE_OFFSET_S;
  const remainingS = expiryCloseTs - nowMs / 1000;

  if (remainingS <= 0) return 0;
  return Math.max(MIN_TIME_YEARS, remainingS / SECONDS_PER_YEAR);
}

function getUsOptionsMarketSession(now: Date = new Date()): OptionsMarketSession {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? "";
  const weekday = part("weekday");
  if (weekday === "Sat" || weekday === "Sun") return "closed";

  const hour = Number(part("hour"));
  const minute = Number(part("minute"));
  const minutes = hour * 60 + minute;
  if (minutes < 9 * 60 + 30) return "pre_market";
  if (minutes < 16 * 60) return "regular";
  return "after_hours";
}

function buildOptionsQuoteStatus(
  contracts: OptionContract[],
  now: Date = new Date(),
): OptionsQuoteStatus {
  const marketSession = getUsOptionsMarketSession(now);
  const totalContracts = contracts.length;
  const zeroBidAskContracts = contracts.filter((c) => c.bid === 0 && c.ask === 0).length;
  const allZeroBidAsk = totalContracts > 0 && zeroBidAskContracts === totalContracts;
  const hasLiveBidAsk = contracts.some((c) => c.bid > 0 || c.ask > 0);

  if (allZeroBidAsk && marketSession !== "regular") {
    return {
      marketSession,
      bidAskState: "closed_market_or_stale_quotes",
      zeroBidAskContracts,
      totalContracts,
      warning:
        "All option contracts have $0.00/$0.00 bid/ask before regular options trading or outside market hours; treat bid/ask as closed-market or stale until the market opens.",
    };
  }

  if (allZeroBidAsk) {
    return {
      marketSession,
      bidAskState: "live_zero_bid_ask",
      zeroBidAskContracts,
      totalContracts,
      warning:
        "All option contracts have $0.00/$0.00 bid/ask during regular options trading hours; verify with a broker, but this may indicate live illiquidity.",
    };
  }

  return {
    marketSession,
    bidAskState: hasLiveBidAsk ? "live_quotes" : "mixed_or_unknown",
    zeroBidAskContracts,
    totalContracts,
    ...(marketSession !== "regular"
      ? {
          warning:
            "Options bid/ask quotes may be stale outside regular options trading hours; verify live executable prices after the market opens.",
        }
      : {}),
  };
}

function parseOptionsResponse(data: YahooOptionsResponse): OptionsChain {
  if (data.optionChain.error) {
    throw new Error(`Yahoo Finance options: ${JSON.stringify(data.optionChain.error)}`);
  }

  const result = data.optionChain.result[0];
  const quote = result.quote;
  const underlyingPrice = quote.regularMarketPrice ?? 0;
  const opts = result.options[0];
  if (!opts && underlyingPrice === 0) {
    throw new InvalidSymbolError(result.underlyingSymbol, "yahoo");
  }
  const riskFreeRate = 0.05;

  const expirationTs = opts.expirationDate;
  const expirationDate = new Date(expirationTs * 1000).toISOString().split("T")[0];
  const timeYears = computeTimeToExpiry(expirationTs);

  const mapContract = (c: any, type: "call" | "put"): OptionContract => {
    const strike = c.strike ?? c.strike?.raw ?? 0;
    const iv = c.impliedVolatility ?? c.impliedVolatility?.raw ?? 0;
    const greeks = computeGreeks({
      type,
      spot: underlyingPrice,
      strike,
      timeYears,
      iv,
      riskFreeRate,
    });
    return {
      contractSymbol: c.contractSymbol ?? "",
      type,
      strike,
      expiration: expirationDate,
      bid: c.bid ?? c.bid?.raw ?? 0,
      ask: c.ask ?? c.ask?.raw ?? 0,
      lastPrice: c.lastPrice ?? c.lastPrice?.raw ?? 0,
      volume: c.volume ?? c.volume?.raw ?? 0,
      openInterest: c.openInterest ?? c.openInterest?.raw ?? 0,
      impliedVolatility: iv,
      inTheMoney: c.inTheMoney ?? false,
      greeks,
    };
  };

  const calls = (opts.calls ?? []).map((c: any) => mapContract(c, "call"));
  const puts = (opts.puts ?? []).map((c: any) => mapContract(c, "put"));
  const totalCallVolume = calls.reduce((s, c) => s + c.volume, 0);
  const totalPutVolume = puts.reduce((s, c) => s + c.volume, 0);
  const quoteStatus = buildOptionsQuoteStatus([...calls, ...puts]);

  return {
    symbol: result.underlyingSymbol,
    underlyingPrice,
    expirationDate,
    expirationDates: result.expirationDates.map(
      (ts) => new Date(ts * 1000).toISOString().split("T")[0],
    ),
    calls,
    puts,
    totalCallVolume,
    totalPutVolume,
    putCallRatio: totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0,
    quoteStatus,
    fetchedAt: new Date().toISOString(),
    asOf: yahooMarketTimeToIso(quote.regularMarketTime),
  };
}

/**
 * Fallback: fetch options data via yahoo-finance2 when the raw Yahoo path is blocked.
 */
async function fetchOptionsViaYahooFinance2(
  symbol: string,
  expiration?: number,
): Promise<YahooOptionsResponse | null> {
  try {
    const result = await getYahooFinance2Client().options(
      symbol,
      expiration ? { date: new Date(expiration * 1000) } : undefined,
    );
    return normalizeYahooFinance2OptionsResponse(result);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function normalizeYahooFinance2OptionsResponse(
  data: YahooFinance2OptionsResult | YahooOptionsResponse,
): YahooOptionsResponse {
  if ("optionChain" in data) return data as YahooOptionsResponse;

  const options = data.options.map((option) => ({
    expirationDate: toYahooUnixSeconds(option.expirationDate),
    calls: option.calls,
    puts: option.puts,
  }));
  const strikes = [
    ...new Set(
      options
        .flatMap((option) => [...option.calls, ...option.puts])
        .map((contract) => Number((contract as { strike?: unknown }).strike))
        .filter((strike) => Number.isFinite(strike)),
    ),
  ].sort((a, b) => a - b);

  return {
    optionChain: {
      result: [
        {
          underlyingSymbol: data.underlyingSymbol,
          expirationDates: data.expirationDates.map(toYahooUnixSeconds),
          strikes,
          quote: data.quote as Record<string, any>,
          options,
        },
      ],
    },
  };
}

function toYahooUnixSeconds(value: Date | number | string): number {
  if (value instanceof Date) return Math.floor(value.getTime() / 1000);
  if (typeof value === "number") {
    return value > 1_000_000_000_000 ? Math.floor(value / 1000) : value;
  }
  return Math.floor(new Date(value).getTime() / 1000);
}

function yahooMarketTimeToIso(value: unknown): string | undefined {
  let date: Date | undefined;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(value < 10_000_000_000 ? value * 1000 : value);
  } else if (typeof value === "string" && value.trim() !== "") {
    const numeric = Number(value);
    date = Number.isFinite(numeric)
      ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
      : new Date(value);
  }
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
