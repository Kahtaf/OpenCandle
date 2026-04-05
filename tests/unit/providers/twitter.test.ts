import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readTwitterCookies, scoreTwitterSentiment, normalizeQuery, getTwitterSentiment } from "../../../src/providers/twitter.js";
import { cache } from "../../../src/infra/cache.js";
import cookieFixture from "../../fixtures/twitter/cookies.json";
import tweetFixture from "../../fixtures/twitter/search-tweets.json";

// Mock node:fs — must be module-level for ESM
const mockExistsSync = vi.fn().mockReturnValue(false);
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, existsSync: (...args: any[]) => mockExistsSync(...args) };
});

// Mock better-sqlite3
vi.mock("better-sqlite3", () => {
  return {
    default: vi.fn(),
  };
});

// Mock @the-convocation/twitter-scraper
vi.mock("@the-convocation/twitter-scraper", () => {
  return {
    Scraper: vi.fn(),
    SearchMode: { Latest: 0 },
  };
});

// Mock opencandle-paths
vi.mock("../../../src/infra/opencandle-paths.js", () => ({
  getBrowserProfileDir: () => "/fake/profile",
}));

describe("readTwitterCookies", () => {
  it("returns empty array when cookies.sqlite does not exist", () => {
    const result = readTwitterCookies("/nonexistent/path");
    expect(result).toEqual([]);
  });
});

describe("normalizeQuery", () => {
  it("prepends $ to bare tickers", () => {
    expect(normalizeQuery("AAPL")).toBe("$AAPL");
    expect(normalizeQuery("TSLA")).toBe("$TSLA");
    expect(normalizeQuery("A")).toBe("$A");
  });

  it("does not double-prefix cashtags", () => {
    expect(normalizeQuery("$TSLA")).toBe("$TSLA");
  });

  it("passes free-form queries through unchanged", () => {
    expect(normalizeQuery("AAPL earnings call")).toBe("AAPL earnings call");
    expect(normalizeQuery("inflation fears")).toBe("inflation fears");
  });

  it("does not prefix lowercase strings", () => {
    expect(normalizeQuery("aapl")).toBe("aapl");
  });

  it("does not prefix strings longer than 5 chars", () => {
    expect(normalizeQuery("ABCDEF")).toBe("ABCDEF");
  });
});

describe("scoreTwitterSentiment", () => {
  it("returns positive score weighted by engagement for bullish tweets", () => {
    const tweets = [
      { text: "So bullish on this breakout! Moon!", likes: 100, retweets: 50 },
    ];
    const result = scoreTwitterSentiment(tweets);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.bullish).toBeGreaterThan(0);
    expect(result.bearish).toBe(0);
  });

  it("returns negative score weighted by engagement for bearish tweets", () => {
    const tweets = [
      { text: "Going to crash, time to sell", likes: 200, retweets: 80 },
    ];
    const result = scoreTwitterSentiment(tweets);
    expect(result.score).toBeLessThan(0);
    expect(result.score).toBeGreaterThanOrEqual(-1);
    expect(result.bearish).toBeGreaterThan(0);
  });

  it("engagement weighting skews toward high-engagement tweets", () => {
    const tweets = [
      { text: "bullish", likes: 1, retweets: 0 },       // low engagement bullish
      { text: "bearish crash", likes: 500, retweets: 200 }, // high engagement bearish
    ];
    const result = scoreTwitterSentiment(tweets);
    // Despite 1 bullish tweet, the high-engagement bearish tweet dominates
    expect(result.score).toBeLessThan(0);
  });

  it("returns 0 for tweets with no sentiment terms", () => {
    const tweets = [
      { text: "Fed decision tomorrow", likes: 10, retweets: 2 },
    ];
    const result = scoreTwitterSentiment(tweets);
    expect(result.score).toBe(0);
    expect(result.bullish).toBe(0);
    expect(result.bearish).toBe(0);
  });

  it("handles empty array", () => {
    const result = scoreTwitterSentiment([]);
    expect(result.score).toBe(0);
    expect(result.bullish).toBe(0);
    expect(result.bearish).toBe(0);
  });
});

describe("getTwitterSentiment", () => {
  beforeEach(() => {
    cache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when no auth cookies exist", async () => {
    // readTwitterCookies will return [] because /fake/profile/cookies.sqlite doesn't exist
    await expect(getTwitterSentiment("AAPL")).rejects.toThrow(
      "No Twitter session found",
    );
  });

  it("returns cached result on second call", async () => {
    mockExistsSync.mockReturnValue(true);

    const { Scraper } = await import("@the-convocation/twitter-scraper");
    const mockScraper = {
      setCookies: vi.fn(),
      isLoggedIn: vi.fn().mockResolvedValue(true),
      searchTweets: vi.fn().mockReturnValue(
        (async function* () {
          for (const tweet of tweetFixture) {
            yield { ...tweet, timeParsed: new Date(tweet.timeParsed) };
          }
        })(),
      ),
    };
    vi.mocked(Scraper).mockImplementation(() => mockScraper as any);

    const Database = (await import("better-sqlite3")).default;
    vi.mocked(Database).mockImplementation(
      () =>
        ({
          prepare: () => ({
            all: (..._args: any[]) => cookieFixture,
          }),
          close: vi.fn(),
        }) as any,
    );

    const result1 = await getTwitterSentiment("AAPL", 50, 24);
    const result2 = await getTwitterSentiment("AAPL", 50, 24);

    expect(result1.query).toBe("$AAPL");
    expect(result2).toEqual(result1);
    // Scraper should only be called once (second call hits cache)
    expect(Scraper).toHaveBeenCalledTimes(1);
  });

  it("throws on expired session", async () => {
    mockExistsSync.mockReturnValue(true);

    const { Scraper } = await import("@the-convocation/twitter-scraper");
    const mockScraper = {
      setCookies: vi.fn(),
      isLoggedIn: vi.fn().mockResolvedValue(false),
    };
    vi.mocked(Scraper).mockImplementation(() => mockScraper as any);

    const Database = (await import("better-sqlite3")).default;
    vi.mocked(Database).mockImplementation(
      () =>
        ({
          prepare: () => ({
            all: (..._args: any[]) => cookieFixture,
          }),
          close: vi.fn(),
        }) as any,
    );

    await expect(getTwitterSentiment("TSLA")).rejects.toThrow(
      "session expired",
    );
  });
});
