import { httpGet } from "../infra/http-client.js";
import { cache, TTL } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import { StealthBrowser } from "../infra/browser.js";
import type { StockQuote, OHLCV } from "../types/market.js";
import type { OptionsChain, OptionContract } from "../types/options.js";
import { computeGreeks } from "../tools/options/greeks.js";

const BASE_URL = "https://query1.finance.yahoo.com/v8/finance/chart";

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

export async function getQuote(symbol: string): Promise<StockQuote> {
  const cacheKey = `yahoo:quote:${symbol}`;
  const cached = cache.get<StockQuote>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("yahoo");

  const url = `${BASE_URL}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const data = await httpGet<YahooChartResponse>(url, {
    headers: { "User-Agent": "Vantage/1.0" },
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
  };

  cache.set(cacheKey, quote, TTL.QUOTE);
  return quote;
}

export async function getHistory(
  symbol: string,
  range: string = "6mo",
  interval: string = "1d",
): Promise<OHLCV[]> {
  const cacheKey = `yahoo:history:${symbol}:${range}:${interval}`;
  const cached = cache.get<OHLCV[]>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("yahoo");

  const url = `${BASE_URL}/${encodeURIComponent(symbol)}?interval=${interval}&range=${range}`;
  const data = await httpGet<YahooChartResponse>(url, {
    headers: { "User-Agent": "Vantage/1.0" },
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
      open: quotes.open[i],
      high: quotes.high[i],
      low: quotes.low[i],
      close: quotes.close[i],
      volume: quotes.volume[i],
    }))
    .filter((bar) => bar.open != null && bar.close != null);

  cache.set(cacheKey, ohlcv, TTL.HISTORY);
  return ohlcv;
}

// --- Options Chain (v7 API with crumb+cookie auth) ---

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

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
  });
  const setCookie = cookieRes.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0]; // Extract just the cookie value

  // Step 2: Use the cookie to get a crumb
  const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
    headers: { "User-Agent": BROWSER_UA, Cookie: cookie },
  });
  const crumb = await crumbRes.text();

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

export async function getOptionsChain(
  symbol: string,
  expiration?: number,
): Promise<OptionsChain> {
  const cacheKey = `yahoo:options:${symbol}:${expiration ?? "nearest"}`;
  const cached = cache.get<OptionsChain>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("yahoo");

  const { crumb, cookie } = await getYahooCrumb();
  const dateParam = expiration ? `&date=${expiration}` : "";
  const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}${dateParam}`;

  let res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Cookie: cookie },
  });

  // On 401 or 429, refresh crumb and retry once
  if (res.status === 401 || res.status === 429) {
    clearCrumbCache();
    const fresh = await getYahooCrumb();
    const retryUrl = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(fresh.crumb)}${dateParam}`;
    res = await fetch(retryUrl, {
      headers: { "User-Agent": BROWSER_UA, Cookie: fresh.cookie },
    });
  }

  // If still failing, fall back to stealth browser (bypasses TLS fingerprinting)
  if (!res.ok) {
    const browserData = await fetchOptionsViaBrowser(symbol, expiration);
    if (browserData) {
      const chain = parseOptionsResponse(symbol, browserData);
      cache.set(cacheKey, chain, TTL.OPTIONS_CHAIN);
      return chain;
    }
    throw new Error(`Yahoo Finance options: HTTP ${res.status}`);
  }

  const data: YahooOptionsResponse = await res.json();
  const chain = parseOptionsResponse(symbol, data);
  cache.set(cacheKey, chain, TTL.OPTIONS_CHAIN);
  return chain;
}

/**
 * Compute time to expiry in years from a Yahoo expiration timestamp (midnight UTC).
 * US equity options expire at 4:00 PM ET. During EDT that is 20:00 UTC.
 * We use 21:00 UTC (4 PM EST / 5 PM EDT) as a conservative close offset
 * and apply a floor of ~1 hour to prevent numerical instability near expiry.
 */
export function computeTimeToExpiry(expirationTs: number, nowMs: number = Date.now()): number {
  const MARKET_CLOSE_OFFSET_S = 21 * 3600; // 21:00 UTC ≈ 4 PM ET
  const MIN_TIME_YEARS = 1 / (365 * 24);   // ~1 hour floor
  const SECONDS_PER_YEAR = 365 * 24 * 3600;

  const expiryCloseTs = expirationTs + MARKET_CLOSE_OFFSET_S;
  const remainingS = expiryCloseTs - nowMs / 1000;

  if (remainingS <= 0) return 0;
  return Math.max(MIN_TIME_YEARS, remainingS / SECONDS_PER_YEAR);
}

function parseOptionsResponse(symbol: string, data: YahooOptionsResponse): OptionsChain {
  if (data.optionChain.error) {
    throw new Error(`Yahoo Finance options: ${JSON.stringify(data.optionChain.error)}`);
  }

  const result = data.optionChain.result[0];
  const quote = result.quote;
  const underlyingPrice = quote.regularMarketPrice ?? 0;
  const opts = result.options[0];
  const riskFreeRate = 0.05;

  const expirationTs = opts.expirationDate;
  const expirationDate = new Date(expirationTs * 1000).toISOString().split("T")[0];
  const timeYears = computeTimeToExpiry(expirationTs);

  const mapContract = (c: any, type: "call" | "put"): OptionContract => {
    const strike = c.strike ?? c.strike?.raw ?? 0;
    const iv = c.impliedVolatility ?? c.impliedVolatility?.raw ?? 0;
    const greeks = computeGreeks({ type, spot: underlyingPrice, strike, timeYears, iv, riskFreeRate });
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

  return {
    symbol: result.underlyingSymbol,
    underlyingPrice,
    expirationDate,
    expirationDates: result.expirationDates.map((ts) => new Date(ts * 1000).toISOString().split("T")[0]),
    calls,
    puts,
    totalCallVolume,
    totalPutVolume,
    putCallRatio: totalCallVolume > 0 ? totalPutVolume / totalCallVolume : 0,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * Fallback: fetch options data via Camoufox stealth browser.
 * Bypasses Yahoo's TLS fingerprinting and rate limiting.
 */
async function fetchOptionsViaBrowser(
  symbol: string,
  expiration?: number,
): Promise<YahooOptionsResponse | null> {
  try {
    // Establish Yahoo session in browser
    await StealthBrowser.initSession("https://finance.yahoo.com");

    // Get crumb + fetch options from within the browser context
    const dateParam = expiration ? `&date=${expiration}` : "";
    const data = await StealthBrowser.run(async (page) => {
      return page.evaluate(async (params: { symbol: string; dateParam: string }) => {
        const crumbRes = await fetch(
          "https://query2.finance.yahoo.com/v1/test/getcrumb",
          { credentials: "include" },
        );
        const crumb = await crumbRes.text();
        const url = `https://query1.finance.yahoo.com/v7/finance/options/${params.symbol}?crumb=${encodeURIComponent(crumb)}${params.dateParam}`;
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) return null;
        return res.json();
      }, { symbol, dateParam });
    });

    return data as YahooOptionsResponse | null;
  } catch {
    return null;
  }
}
