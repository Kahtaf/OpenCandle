interface BucketConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
}

interface Bucket {
  tokens: number;
  lastRefill: number;
  config: BucketConfig;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  configure(provider: string, maxTokens: number, refillRate: number): void {
    this.buckets.set(provider, {
      tokens: maxTokens,
      lastRefill: Date.now(),
      config: { maxTokens, refillRate },
    });
  }

  async acquire(provider: string): Promise<void> {
    const bucket = this.buckets.get(provider);
    if (!bucket) return; // No limit configured

    this.refill(bucket);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return;
    }

    // Wait until a token is available
    const waitMs = ((1 - bucket.tokens) / bucket.config.refillRate) * 1000;
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(waitMs)));
    this.refill(bucket);
    bucket.tokens -= 1;
  }

  private refill(bucket: Bucket): void {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      bucket.config.maxTokens,
      bucket.tokens + elapsed * bucket.config.refillRate,
    );
    bucket.lastRefill = now;
  }
}

// Shared instance with default provider limits
export const rateLimiter = new RateLimiter();
rateLimiter.configure("yahoo", 5, 5);           // 5 req/s
rateLimiter.configure("coingecko", 10, 0.167);  // 10 req/min
rateLimiter.configure("alphavantage", 5, 0.083); // 5 req/min (free tier)
rateLimiter.configure("fred", 120, 2);           // 120 req/min
