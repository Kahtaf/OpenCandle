import { AsyncLocalStorage } from "node:async_hooks";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  cachedAt: number;
}

export interface StaleResult<T> {
  value: T;
  stale: true;
  cachedAt: number;
}

interface CacheMetadata {
  status: "none" | "cached" | "stale";
  cachedAt: number;
}

const cacheMetadataStorage = new AsyncLocalStorage<CacheMetadata>();

export async function runWithStaleMetadata<T>(fn: () => Promise<T>): Promise<{
  value: T;
  cache?: { status: "cached" | "stale"; cachedAt: number };
  stale?: { cachedAt: number };
}> {
  const metadata: CacheMetadata = { status: "none", cachedAt: 0 };
  const value = await cacheMetadataStorage.run(metadata, fn);
  return {
    value,
    cache:
      metadata.status === "cached" || metadata.status === "stale"
        ? { status: metadata.status, cachedAt: metadata.cachedAt }
        : undefined,
    stale: metadata.status === "stale" ? { cachedAt: metadata.cachedAt } : undefined,
  };
}

export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) return undefined;
    const metadata = cacheMetadataStorage.getStore();
    if (metadata && metadata.status === "none") {
      metadata.status = "cached";
      metadata.cachedAt = entry.cachedAt;
    }
    return entry.value as T;
  }

  /**
   * Return an expired entry if it exists and is within the stale limit.
   * Unlike get(), this does not require the entry to be within its TTL.
   * Entries beyond the stale limit are deleted.
   */
  getStale<T>(key: string, staleLimitMs: number): StaleResult<T> | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;

    if (Date.now() > entry.cachedAt + staleLimitMs) {
      this.store.delete(key);
      return undefined;
    }

    const metadata = cacheMetadataStorage.getStore();
    if (metadata) {
      metadata.status = "stale";
      metadata.cachedAt = entry.cachedAt;
    }
    return { value: entry.value as T, stale: true, cachedAt: entry.cachedAt };
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs, cachedAt: Date.now() });
  }

  invalidate(pattern: string): void {
    for (const key of this.store.keys()) {
      if (key.includes(pattern)) {
        this.store.delete(key);
      }
    }
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// Shared cache instance
export const cache = new Cache();

// Default TTLs
export const TTL = {
  QUOTE: 60_000, // 1 minute
  HISTORY: 3_600_000, // 1 hour
  CANDLES: 3_600_000, // 1 hour
  FUNDAMENTALS: 86_400_000, // 24 hours
  FINANCIAL_REPORTS: 86_400_000, // 24 hours
  MACRO: 3_600_000, // 1 hour
  SENTIMENT: 300_000, // 5 minutes
  OPTIONS_CHAIN: 120_000, // 2 minutes
  SCREENER: 60_000, // 1 minute
  CRUMB: 900_000, // 15 minutes
  WEB_SEARCH: 300_000, // 5 minutes
  FINNHUB_NEWS: 300_000, // 5 minutes
  PREDICTION_MARKETS: 300_000, // 5 minutes
} as const;

// Stale limits — how long past TTL expiry a cached value is still useful as fallback
export const STALE_LIMIT = {
  QUOTE: 15 * 60_000, // 15 minutes
  HISTORY: 24 * 3_600_000, // 24 hours
  CANDLES: 24 * 3_600_000, // 24 hours
  FUNDAMENTALS: 7 * 86_400_000, // 7 days
  FINANCIAL_REPORTS: 7 * 86_400_000, // 7 days
  MACRO: 24 * 3_600_000, // 24 hours
  SENTIMENT: 3_600_000, // 1 hour
  OPTIONS_CHAIN: 30 * 60_000, // 30 minutes
  SCREENER: 15 * 60_000, // 15 minutes
  WEB_SEARCH: 3_600_000, // 1 hour
  FINNHUB_NEWS: 3_600_000, // 1 hour
  PREDICTION_MARKETS: 3_600_000, // 1 hour
} as const;
