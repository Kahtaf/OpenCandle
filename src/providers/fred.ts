import { httpGet } from "../infra/http-client.js";
import { cache, TTL } from "../infra/cache.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { FredSeries, FredObservation } from "../types/macro.js";

const BASE_URL = "https://api.stlouisfed.org/fred";

interface FredSeriesResponse {
  seriess: Array<{
    id: string;
    title: string;
    units: string;
    frequency: string;
    last_updated: string;
  }>;
}

interface FredObservationsResponse {
  observations: Array<{
    date: string;
    value: string;
  }>;
}

export async function getSeries(
  seriesId: string,
  apiKey: string,
  limit: number = 60,
): Promise<FredSeries> {
  const cacheKey = `fred:series:${seriesId}:${limit}`;
  const cached = cache.get<FredSeries>(cacheKey);
  if (cached) return cached;

  await rateLimiter.acquire("fred");

  // Fetch series metadata and observations in parallel
  const metaUrl = `${BASE_URL}/series?series_id=${seriesId}&api_key=${apiKey}&file_type=json`;
  const obsUrl = `${BASE_URL}/series/observations?series_id=${seriesId}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=${limit}`;

  const [metaData, obsData] = await Promise.all([
    httpGet<FredSeriesResponse>(metaUrl),
    httpGet<FredObservationsResponse>(obsUrl),
  ]);

  const meta = metaData.seriess[0];
  const observations: FredObservation[] = obsData.observations
    .filter((o) => o.value !== ".")
    .map((o) => ({
      date: o.date,
      value: parseFloat(o.value),
    }))
    .reverse(); // chronological order

  const result: FredSeries = {
    id: meta.id,
    title: meta.title,
    observations,
    units: meta.units,
    frequency: meta.frequency,
    lastUpdated: meta.last_updated,
  };

  cache.set(cacheKey, result, TTL.MACRO);
  return result;
}
