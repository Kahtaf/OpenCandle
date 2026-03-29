import { describe, it, expect, vi } from "vitest";
import { RateLimiter } from "../../../src/infra/rate-limiter.js";

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
});
