import { cache, STALE_LIMIT, TTL } from "../infra/cache.js";
import { HttpError, httpGet } from "../infra/http-client.js";
import { rateLimiter } from "../infra/rate-limiter.js";
import type { FredObservation, FredSeries } from "../types/macro.js";
import { ProviderCredentialError } from "./provider-credential-error.js";

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

  try {
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
  } catch (error) {
    // FRED historically returns 400 with a body like "Bad Request. The value
    // for variable api_key is not registered..." when the key is invalid. A
    // separate 400 can also indicate a bad series_id, which is NOT a credential
    // problem. We only reclassify as credential-related on 401/403 here to
    // avoid surfacing a `/connect` prompt when the user's real mistake is a
    // typo in a series id. Bad-FRED-key users will still see the raw error
    // message in v1; a body-string check can be added later if this becomes a
    // reported friction.
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      throw new ProviderCredentialError("fred", "stale", error.status);
    }
    const stale = cache.getStale<FredSeries>(cacheKey, STALE_LIMIT.MACRO);
    if (stale) return stale.value;
    throw error;
  }
}
