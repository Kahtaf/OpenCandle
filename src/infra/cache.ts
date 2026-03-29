interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class Cache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
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
