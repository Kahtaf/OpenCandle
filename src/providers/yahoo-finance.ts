import { httpGet } from "../infra/http-client.js";
import { cache, TTL, STALE_LIMIT } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import { StealthBrowser } from "../infra/browser.js";
import type { StockQuote, OHLCV } from "../types/market.js";
import type { OptionsChain, OptionContract, OptionsMarketSession, OptionsQuoteStatus } from "../types/options.js";
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

  try {
    await rateLimiter.acquire("yahoo");

    const url = `${BASE_URL}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const data = await httpGet<YahooChartResponse>(url, {
      headers: { "User-Agent": "OpenCandle/1.0" },
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
  } catch (error) {
    const stale = cache.getStale<StockQuote>(cacheKey, STALE_LIMIT.QUOTE);
    if (stale) return stale.value;
    throw error;
  }
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

  let res: Response | null = null;
  let fetchError: unknown;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": BROWSER_UA, Cookie: cookie },
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
      const browserData = await fetchOptionsViaBrowser(symbol, expiration);
      if (browserData) {
        const chain = parseOptionsResponse(browserData);
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
        throw new Error(`${message}; browser fallback failed: ${browserError.message}`);
      }
      throw new Error(message);
    }
    if (browserError instanceof Error) {
      const message = fetchError instanceof Error ? fetchError.message : "Yahoo Finance options: fetch failed";
      throw new Error(`${message}; browser fallback failed: ${browserError.message}`);
    }
    throw fetchError instanceof Error ? fetchError : new Error("Yahoo Finance options: fetch failed");
  }

  const data: YahooOptionsResponse = await res.json();
  const chain = parseOptionsResponse(data);
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

export function getUsOptionsMarketSession(now: Date = new Date()): OptionsMarketSession {
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

export function buildOptionsQuoteStatus(
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
  const quoteStatus = buildOptionsQuoteStatus([...calls, ...puts]);

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
    quoteStatus,
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
    // Avoid loading the script-heavy Yahoo Finance homepage: Playwright 1.60
    // can crash on some pageerror payloads emitted by finance.yahoo.com.
    // Navigating directly to Yahoo's JSON endpoints still uses the browser's
    // cookies/TLS fingerprint without requiring cross-origin fetch from page JS.
    const dateParam = expiration ? `&date=${expiration}` : "";
    return await StealthBrowser.run(async (page) => {
      await page.goto("https://query2.finance.yahoo.com/v1/test/getcrumb", {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      const crumb = (await page.locator("body").innerText()).trim();
      if (!crumb) return null;

      const url = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(symbol)}?crumb=${encodeURIComponent(crumb)}${dateParam}`;
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      });
      if (!response?.ok()) return null;

      const text = (await page.locator("body").innerText()).trim();
      return JSON.parse(text) as YahooOptionsResponse;
    });
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}
