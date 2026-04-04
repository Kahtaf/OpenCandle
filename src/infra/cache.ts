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

export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();
  private lastStaleHit = false;
  private lastStaleCachedAt = 0;

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) return undefined;
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

    this.lastStaleHit = true;
    this.lastStaleCachedAt = entry.cachedAt;
    return { value: entry.value as T, stale: true, cachedAt: entry.cachedAt };
  }

  /**
   * Consume the stale flag set by the last getStale() hit.
   * Returns { stale: true, cachedAt } if the last getStale() found data,
   * then resets the flag. Used by wrapProvider to propagate stale metadata.
   */
  consumeStaleFlag(): { stale: boolean; cachedAt: number } {
    const result = { stale: this.lastStaleHit, cachedAt: this.lastStaleCachedAt };
    this.lastStaleHit = false;
    this.lastStaleCachedAt = 0;
    return result;
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
  QUOTE: 60_000,         // 1 minute
  HISTORY: 3_600_000,    // 1 hour
  FUNDAMENTALS: 86_400_000, // 24 hours
  MACRO: 3_600_000,      // 1 hour
  SENTIMENT: 300_000,    // 5 minutes
  OPTIONS_CHAIN: 120_000, // 2 minutes
  CRUMB: 900_000,        // 15 minutes
} as const;

// Stale limits — how long past TTL expiry a cached value is still useful as fallback
export const STALE_LIMIT = {
  QUOTE: 15 * 60_000,             // 15 minutes
  HISTORY: 24 * 3_600_000,        // 24 hours
  FUNDAMENTALS: 7 * 86_400_000,   // 7 days
  MACRO: 24 * 3_600_000,          // 24 hours
  SENTIMENT: 3_600_000,           // 1 hour
  OPTIONS_CHAIN: 30 * 60_000,     // 30 minutes
} as const;
