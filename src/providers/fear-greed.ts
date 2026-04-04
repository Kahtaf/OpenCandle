import { httpGet } from "../infra/http-client.js";
import { cache, TTL, STALE_LIMIT } from "../infra/cache.js";
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
    const data = await httpGet<AlternativeMeFngResponse>(ENDPOINT);

    const entries = data.data;
    const current = entries[0];
    const value = parseInt(current.value, 10);

    const result: FearGreedData = {
      value,
      label: current.value_classification,
      timestamp: Date.now(),
      previousClose: entries[1] ? parseInt(entries[1].value, 10) : value,
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
