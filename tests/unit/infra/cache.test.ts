import { describe, it, expect, beforeEach, vi } from "vitest";
import { Cache } from "../../../src/infra/cache.js";

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
});
