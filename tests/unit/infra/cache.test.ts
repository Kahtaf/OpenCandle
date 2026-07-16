import { beforeEach, describe, expect, it, vi } from "vitest";
import { Cache, runWithStaleMetadata, STALE_LIMIT, TTL } from "../../../src/infra/cache.js";

describe("Cache", () => {
  let cache: Cache;

  beforeEach(() => {
    cache = new Cache();
  });

  it("returns undefined for missing keys", () => {
    expect(cache.get("missing")).toBeUndefined();
  });

  it("stores and retrieves values", () => {
    cache.set("key", { price: 150 }, 60_000);
    expect(cache.get("key")).toEqual({ price: 150 });
  });

  it("returns undefined for expired entries", () => {
    vi.useFakeTimers();
    cache.set("key", "value", 100);
    vi.advanceTimersByTime(101);
    expect(cache.get("key")).toBeUndefined();
    vi.useRealTimers();
  });

  it("returns value before expiry", () => {
    vi.useFakeTimers();
    cache.set("key", "value", 100);
    vi.advanceTimersByTime(50);
    expect(cache.get("key")).toBe("value");
    vi.useRealTimers();
  });

  it("invalidates keys matching pattern", () => {
    cache.set("yahoo:quote:AAPL", 1, 60_000);
    cache.set("yahoo:quote:MSFT", 2, 60_000);
    cache.set("coingecko:price:btc", 3, 60_000);
    cache.invalidate("yahoo:quote");
    expect(cache.get("yahoo:quote:AAPL")).toBeUndefined();
    expect(cache.get("yahoo:quote:MSFT")).toBeUndefined();
    expect(cache.get("coingecko:price:btc")).toBe(3);
  });

  it("clears all entries", () => {
    cache.set("a", 1, 60_000);
    cache.set("b", 2, 60_000);
    cache.clear();
    expect(cache.size).toBe(0);
  });

  it("overwrites existing entries", () => {
    cache.set("key", "old", 60_000);
    cache.set("key", "new", 60_000);
    expect(cache.get("key")).toBe("new");
  });

  describe("getStale", () => {
    it("returns stale entry within stale limit", () => {
      vi.useFakeTimers();
      cache.set("key", { price: 150 }, 100); // TTL 100ms
      vi.advanceTimersByTime(200); // TTL expired
      expect(cache.get("key")).toBeUndefined();

      const stale = cache.getStale<{ price: number }>("key", 1000); // stale limit 1000ms
      expect(stale).toBeDefined();
      expect(stale?.value).toEqual({ price: 150 });
      expect(stale?.stale).toBe(true);
      expect(stale?.cachedAt).toBeGreaterThan(0);
      vi.useRealTimers();
    });

    it("returns undefined beyond stale limit", () => {
      vi.useFakeTimers();
      cache.set("key", "data", 100); // TTL 100ms
      vi.advanceTimersByTime(2000); // beyond stale limit of 500ms
      const stale = cache.getStale("key", 500);
      expect(stale).toBeUndefined();
      // Entry should be deleted
      expect(cache.size).toBe(0);
      vi.useRealTimers();
    });

    it("returns undefined when no entry exists", () => {
      expect(cache.getStale("nonexistent", 60_000)).toBeUndefined();
    });

    it("does not interfere with get() for fresh entries", () => {
      vi.useFakeTimers();
      cache.set("key", "fresh", 1000);
      vi.advanceTimersByTime(500); // within TTL
      expect(cache.get("key")).toBe("fresh");
      vi.useRealTimers();
    });

    it("returns stale data for entry that is expired but within stale limit", () => {
      vi.useFakeTimers();
      cache.set("key", "data", 100);
      vi.advanceTimersByTime(150); // expired TTL (100ms) but within stale limit (500ms)
      expect(cache.get("key")).toBeUndefined();
      const stale = cache.getStale("key", 500);
      expect(stale).toBeDefined();
      expect(stale?.value).toBe("data");
      vi.useRealTimers();
    });
  });

  describe("runWithStaleMetadata", () => {
    it("records fresh cache-hit metadata inside the current async scope", async () => {
      vi.useFakeTimers();
      cache.set("key", "data", 1000);
      const cachedAt = Date.now();
      vi.advanceTimersByTime(100);

      const result = await runWithStaleMetadata(async () => cache.get("key"));

      expect(result.value).toBe("data");
      expect(result.cache).toEqual({ status: "cached", cachedAt });
      expect(result.stale).toBeUndefined();
      vi.useRealTimers();
    });

    it("records stale metadata inside the current async scope", async () => {
      vi.useFakeTimers();
      cache.set("key", "data", 100);
      const cachedAt = Date.now();
      vi.advanceTimersByTime(200);

      const result = await runWithStaleMetadata(async () => {
        return cache.getStale("key", 1000)?.value;
      });

      expect(result.value).toBe("data");
      expect(result.cache).toEqual({ status: "stale", cachedAt });
      expect(result.stale).toEqual({ cachedAt });
      vi.useRealTimers();
    });

    it("does not leak stale metadata between concurrent async scopes", async () => {
      vi.useFakeTimers();
      cache.set("key", "data", 100);
      vi.advanceTimersByTime(200);

      const staleCall = runWithStaleMetadata(async () => {
        const stale = cache.getStale("key", 1000)?.value;
        await Promise.resolve();
        return stale;
      });
      const freshCall = runWithStaleMetadata(async () => {
        await Promise.resolve();
        return "fresh";
      });

      const [staleResult, freshResult] = await Promise.all([staleCall, freshCall]);

      expect(staleResult.stale).toBeDefined();
      expect(freshResult.stale).toBeUndefined();
      vi.useRealTimers();
    });

    it("does not record stale metadata for getStale misses", async () => {
      vi.useFakeTimers();
      cache.set("key", "data", 100);
      vi.advanceTimersByTime(5000);
      const result = await runWithStaleMetadata(async () => cache.getStale("key", 500));
      expect(result.stale).toBeUndefined();
      vi.useRealTimers();
    });
  });
});

describe("LSE cache domains", () => {
  it("uses the specified candle and financial-report fresh and stale lifetimes", () => {
    expect(TTL.CANDLES).toBe(3_600_000);
    expect(TTL.FINANCIAL_REPORTS).toBe(86_400_000);
    expect(STALE_LIMIT.CANDLES).toBe(24 * 3_600_000);
    expect(STALE_LIMIT.FINANCIAL_REPORTS).toBe(7 * 86_400_000);
  });
});
