import { describe, it, expect, vi } from "vitest";
import {
  ALPHA_VANTAGE_RATE_LIMIT,
  RateLimiter,
} from "../../../src/infra/rate-limiter.js";

describe("RateLimiter", () => {
  it("allows requests within limit", async () => {
    const limiter = new RateLimiter();
    limiter.configure("test", 3, 1); // 3 tokens, 1/sec refill

    // Should not throw for 3 rapid requests
    await limiter.acquire("test");
    await limiter.acquire("test");
    await limiter.acquire("test");
  });

  it("passes through unconfigured providers", async () => {
    const limiter = new RateLimiter();
    // Should not throw or block
    await limiter.acquire("unknown");
  });

  it("waits when tokens are exhausted", async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter();
    limiter.configure("test", 1, 10); // 1 token, 10/sec refill

    await limiter.acquire("test"); // consumes the 1 token

    const acquirePromise = limiter.acquire("test");
    // Should be waiting for a token
    vi.advanceTimersByTime(200);
    await acquirePromise; // Should resolve after refill
    vi.useRealTimers();
  });

  it("refills tokens over time", async () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter();
    limiter.configure("test", 2, 1); // 2 tokens, 1/sec refill

    await limiter.acquire("test");
    await limiter.acquire("test");
    // tokens exhausted

    vi.advanceTimersByTime(2000); // 2 seconds → 2 tokens refilled

    // Should work without waiting
    await limiter.acquire("test");
    await limiter.acquire("test");
    vi.useRealTimers();
  });

  it("paces Alpha Vantage requests at the free-tier minute limit by default", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter();
      limiter.configure(
        "alphavantage",
        ALPHA_VANTAGE_RATE_LIMIT.maxTokens,
        ALPHA_VANTAGE_RATE_LIMIT.refillRate,
      );

      for (let i = 0; i < ALPHA_VANTAGE_RATE_LIMIT.maxTokens; i += 1) {
        await limiter.acquire("alphavantage");
      }

      let acquired = false;
      const acquirePromise = limiter.acquire("alphavantage").then(() => {
        acquired = true;
      });

      const waitMs = Math.ceil((1 / ALPHA_VANTAGE_RATE_LIMIT.refillRate) * 1000);
      await vi.advanceTimersByTimeAsync(waitMs - 1);
      expect(acquired).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await acquirePromise;
      expect(acquired).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes concurrent waiters one token per refill", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter();
      limiter.configure("test", 1, 1);

      await limiter.acquire("test");

      let firstAcquired = false;
      let secondAcquired = false;
      const first = limiter.acquire("test").then(() => {
        firstAcquired = true;
      });
      const second = limiter.acquire("test").then(() => {
        secondAcquired = true;
      });

      await vi.advanceTimersByTimeAsync(999);
      expect(firstAcquired).toBe(false);
      expect(secondAcquired).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await first;
      expect(firstAcquired).toBe(true);
      expect(secondAcquired).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      await second;
      expect(secondAcquired).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
