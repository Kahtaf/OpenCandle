import { describe, expect, it, vi } from "vitest";
import { ALPHA_VANTAGE_RATE_LIMIT, RateLimiter } from "../../../src/infra/rate-limiter.js";

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

  it("does not let concurrent waiters spend the same refilled token", async () => {
    vi.useFakeTimers();
    try {
      const limiter = new RateLimiter();
      limiter.configure("test", 1, 10); // 1 token, 10/sec refill

      await limiter.acquire("test");

      let firstAcquired = false;
      let secondAcquired = false;
      const first = limiter.acquire("test").then(() => {
        firstAcquired = true;
      });
      const second = limiter.acquire("test").then(() => {
        secondAcquired = true;
      });

      await vi.advanceTimersByTimeAsync(100);
      await first;
      expect(firstAcquired).toBe(true);
      expect(secondAcquired).toBe(false);

      await vi.advanceTimersByTimeAsync(100);
      await second;
      expect(secondAcquired).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("configures a sec_edgar bucket on the shared limiter", async () => {
    vi.useFakeTimers();
    try {
      const { rateLimiter } = await import("../../../src/infra/rate-limiter.js");

      // Drain whatever tokens the bucket holds; an unconfigured provider
      // would never block, so a pending acquire proves the bucket exists.
      for (let i = 0; i < 20; i++) {
        const drain = rateLimiter.acquire("sec_edgar");
        await vi.advanceTimersByTimeAsync(0);
        let drained = false;
        void drain.then(() => {
          drained = true;
        });
        await Promise.resolve();
        if (!drained) {
          await vi.advanceTimersByTimeAsync(10_000);
          await drain;
          return;
        }
        await drain;
      }
      throw new Error("sec_edgar acquire never blocked; bucket is not configured");
    } finally {
      vi.useRealTimers();
    }
  });

  it("configures the shared lse bucket for the 100 requests/minute free tier", async () => {
    vi.useFakeTimers();
    try {
      const { rateLimiter } = await import("../../../src/infra/rate-limiter.js");

      for (let i = 0; i < 100; i += 1) {
        await rateLimiter.acquire("lse");
      }

      let acquired = false;
      const acquirePromise = rateLimiter.acquire("lse").then(() => {
        acquired = true;
      });

      await vi.advanceTimersByTimeAsync(602);
      expect(acquired).toBe(false);

      await vi.advanceTimersByTimeAsync(1);
      await acquirePromise;
      expect(acquired).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
