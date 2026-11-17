import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { httpGet } from "../infra/http-client.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { FearGreedData } from "../types/sentiment.js";

// alternative.me provides a free crypto Fear & Greed index
// CNN endpoint (production.dataviz.cnn.io) blocks automated requests (HTTP 418)
const ENDPOINT = "https://api.alternative.me/fng/?limit=3";

interface AlternativeMeFngResponse {
  data: Array<{
    value: string;
    value_classification: string;
    timestamp: string;
  }>;
}

export async function getFearGreedIndex(): Promise<FearGreedData> {
  const cacheKey = "feargreed:index";
  const cached = cache.get<FearGreedData>(cacheKey);
  if (cached) return cached;

  try {
    await rateLimiter.acquire("feargreed");
    const data = await httpGet<AlternativeMeFngResponse>(ENDPOINT, { maxRetries: 0 });

    const entries = data.data;
    if (!Array.isArray(entries) || entries.length === 0)
      throw new Error("Invalid Fear & Greed response");
    for (const entry of entries) {
      const value = Number(entry.value);
      const epoch = Number(entry.timestamp) * 1000;
      if (
        !entry.value?.trim() ||
        !Number.isFinite(value) ||
        value < 0 ||
        value > 100 ||
        typeof entry.value_classification !== "string" ||
        !entry.value_classification.trim() ||
        !Number.isFinite(epoch) ||
        epoch <= 0 ||
        !Number.isFinite(new Date(epoch).getTime())
      ) {
        throw new Error("Invalid Fear & Greed observation");
      }
    }
    const current = entries[0];
    const value = Number(current.value);

    const result: FearGreedData = {
      value,
      label: current.value_classification,
      timestamp: Date.now(),
      asOf: new Date(Number(current.timestamp) * 1000).toISOString(),
      previousClose: entries[1] ? Number(entries[1].value) : value,
      weekAgo: null,
      monthAgo: null,
    };

    cache.set(cacheKey, result, TTL.SENTIMENT);
    return result;
  } catch (error) {
    const stale = cache.getStale<FearGreedData>(cacheKey, STALE_LIMIT.SENTIMENT);
    if (stale) return stale.value;
    throw error;
  }
}
