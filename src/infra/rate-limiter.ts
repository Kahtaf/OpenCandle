interface BucketConfig {
  maxTokens: number;
  refillRate: number; // tokens per second
}

interface Bucket {
  tokens: number;
  lastRefill: number;
  config: BucketConfig;
}

export const ALPHA_VANTAGE_RATE_LIMIT = {
  maxTokens: 5,
  refillRate: 0.083,
} as const;

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

    while (true) {
      this.refill(bucket);

      if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return;
      }

      const waitMs = ((1 - bucket.tokens) / bucket.config.refillRate) * 1000;
      await new Promise((resolve) => setTimeout(resolve, Math.ceil(waitMs)));
    }
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
rateLimiter.configure("yahoo", 5, 5); // 5 req/s
rateLimiter.configure("coingecko", 10, 0.167); // 10 req/min
rateLimiter.configure(
  "alphavantage",
  ALPHA_VANTAGE_RATE_LIMIT.maxTokens,
  ALPHA_VANTAGE_RATE_LIMIT.refillRate,
); // 5 req/min (free tier)
rateLimiter.configure("fred", 120, 2); // 120 req/min
rateLimiter.configure("twitter", 5, 0.167); // 5 req, ~10 req/min
rateLimiter.configure("reddit", 5, 0.167); // 5 req, ~10 req/min
rateLimiter.configure("reddit_comments", 10, 0.5); // 10 req, ~30 req/min
rateLimiter.configure("ddg", 3, 0.1); // 3 req, ~6 req/min
rateLimiter.configure("brave_search", 5, 0.083); // 5 req, ~5 req/min
rateLimiter.configure("exa", 5, 0.1); // 5 req, ~6 req/min
rateLimiter.configure("finnhub", 60, 1); // 60 req/min (free tier)
rateLimiter.configure("ticker_line", 10, 5); // 10 request burst, 5 req/s sustained
// TradingView scanner is undocumented; keep usage batch-first and paced.
rateLimiter.configure("tradingview", 5, 1); // 5 burst, 1 req/s sustained
rateLimiter.configure("polymarket", 10, 5); // 10 burst, 5 req/s sustained
// SEC EDGAR fair-access guideline is 10 req/s; stay below it.
rateLimiter.configure("sec_edgar", 5, 5); // 5 burst, 5 req/s sustained
rateLimiter.configure("lse", 100, 1.66); // 100 req/min (free tier)
