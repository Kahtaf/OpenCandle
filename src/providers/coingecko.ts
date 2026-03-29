import { httpGet } from "../infra/http-client.js";
import { cache, TTL } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { CryptoPrice, OHLCV } from "../types/market.js";

const BASE_URL = "https://api.coingecko.com/api/v3";

interface CoinGeckoDetailResponse {
  id: string;
  symbol: string;
  name: string;
  market_data: {
    current_price: { usd: number };
    price_change_24h: number;
    price_change_percentage_24h: number;
    market_cap: { usd: number };
    total_volume: { usd: number };
    high_24h: { usd: number };
    low_24h: { usd: number };
    ath: { usd: number };
    ath_date: { usd: string };
    circulating_supply: number;
    total_supply: number | null;
  };
}

export async function getCryptoPrice(id: string): Promise<CryptoPrice> {
  const cacheKey = `coingecko:price:${id}`;
  const cached = cache.get<CryptoPrice>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("coingecko");

  const url = `${BASE_URL}/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false`;
  const data = await httpGet<CoinGeckoDetailResponse>(url);

  const md = data.market_data;
  const result: CryptoPrice = {
    id: data.id,
    symbol: data.symbol,
    name: data.name,
    price: md.current_price.usd,
    change24h: md.price_change_24h,
    changePercent24h: md.price_change_percentage_24h,
    marketCap: md.market_cap.usd,
    volume24h: md.total_volume.usd,
    high24h: md.high_24h.usd,
    low24h: md.low_24h.usd,
    ath: md.ath.usd,
    athDate: md.ath_date.usd,
    circulatingSupply: md.circulating_supply,
    totalSupply: md.total_supply,
    timestamp: Date.now(),
  };

  cache.set(cacheKey, result, TTL.QUOTE);
  return result;
}

export async function getCryptoHistory(
  id: string,
  days: number = 180,
): Promise<OHLCV[]> {
  const cacheKey = `coingecko:history:${id}:${days}`;
  const cached = cache.get<OHLCV[]>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("coingecko");

  const url = `${BASE_URL}/coins/${encodeURIComponent(id)}/ohlc?vs_currency=usd&days=${days}`;
  const data = await httpGet<number[][]>(url);

  const ohlcv: OHLCV[] = data.map(([ts, open, high, low, close]) => ({
    date: new Date(ts).toISOString().split("T")[0],
    open,
    high,
    low,
    close,
    volume: 0, // OHLC endpoint doesn't include volume
  }));

  cache.set(cacheKey, ohlcv, TTL.HISTORY);
  return ohlcv;
}
