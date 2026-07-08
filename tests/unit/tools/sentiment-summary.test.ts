import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cache } from "../../../src/infra/cache.js";
import {
  getDefaultOnboardingState,
  markProviderNeverAsk,
  saveOnboardingState,
} from "../../../src/onboarding/state.js";
import type { ProviderResult } from "../../../src/runtime/evidence.js";
import type { AskUserHandler } from "../../../src/types/index.js";
import type { WebSearchEnvelope } from "../../../src/types/sentiment.js";
import listingFixture from "../../fixtures/reddit/listing-with-ids.json";

const originalFetch = globalThis.fetch;

// Mock the web-search provider
vi.mock("../../../src/providers/web-search.js", () => ({
  searchWeb: vi.fn(),
}));

vi.mock("../../../src/providers/yahoo-finance.js", () => ({
  getQuote: vi.fn(),
}));

// Mock reddit provider calls that are not reached through wrapProvider in this tool.
vi.mock("../../../src/providers/reddit.js", () => ({
  getSubredditPosts: vi.fn(),
  getPostComments: vi.fn(async () => []),
}));

// Mock the twitter provider to avoid scraper initialization
vi.mock("../../../src/providers/twitter.js", () => ({
  getTwitterSentiment: vi.fn(),
}));

// Mock the finnhub provider
vi.mock("../../../src/providers/finnhub.js", () => ({
  getCompanyNews: vi.fn(),
  finnhubDateRange: vi.fn(() => ({ from: "2026-04-10", to: "2026-04-11" })),
}));

// Mock wrap-provider to avoid stale-cache retry delays
vi.mock("../../../src/providers/wrap-provider.js", () => ({
  wrapProvider: vi.fn(),
}));

// Mock config to control finnhubApiKey
vi.mock("../../../src/config.js", () => ({
  getConfig: vi.fn(() => ({ finnhubApiKey: undefined })),
}));

// Mock the sentiment singleton to use :memory:
vi.mock("../../../src/sentiment/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/sentiment/index.js")>();
  const { SentimentStore } = await import("../../../src/sentiment/store.js");
  const { SentimentPipeline } = await import("../../../src/sentiment/pipeline.js");
  const memStore = new SentimentStore(":memory:");
  const pipeline = new SentimentPipeline(memStore, {
    retentionDays: 30,
    defaultSubreddits: ["stocks"],
    commentsPerPost: 5,
    divergenceThreshold: 0.4,
  });
  return {
    ...actual,
    getSentimentPipeline: () => pipeline,
    getSentimentStore: () => memStore,
  };
});

import { getConfig } from "../../../src/config.js";
import { getCompanyNews } from "../../../src/providers/finnhub.js";
import { getPostComments } from "../../../src/providers/reddit.js";
import { getTwitterSentiment } from "../../../src/providers/twitter.js";
import { searchWeb } from "../../../src/providers/web-search.js";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import { getQuote } from "../../../src/providers/yahoo-finance.js";
import {
  createSentimentSummaryTool,
  sentimentSummaryTool,
} from "../../../src/tools/sentiment/sentiment-summary.js";

const _mockedGetTwitterSentiment = vi.mocked(getTwitterSentiment);
const mockedGetPostComments = vi.mocked(getPostComments);
const mockedWrapProvider = vi.mocked(wrapProvider);
const mockedSearchWeb = vi.mocked(searchWeb);
const mockedGetQuote = vi.mocked(getQuote);
const mockedGetCompanyNews = vi.mocked(getCompanyNews);
const mockedGetConfig = vi.mocked(getConfig);

beforeEach(() => {
  cache.clear();
  vi.clearAllMocks();
  mockedGetConfig.mockReturnValue({ finnhubApiKey: undefined } as any);
  mockedGetQuote.mockRejectedValue(new Error("quote unavailable"));
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("get_sentiment_summary tool", () => {
  it("has correct tool name", () => {
    expect(sentimentSummaryTool.name).toBe("get_sentiment_summary");
  });

  it("returns per-source breakdown when reddit and web available", async () => {
    // Mock twitter wrapProvider as unavailable
    mockedWrapProvider.mockImplementation(async (provider, _fn) => {
      if (provider === "twitter") {
        return { status: "unavailable", reason: "No Twitter session found" } as any;
      }
      // Reddit — return fixture data
      return {
        status: "ok",
        data: {
          subreddit: "stocks",
          postCount: 3,
          posts: listingFixture.data.children.map((c: any) => ({
            id: c.data.id,
            title: c.data.title,
            selftext: c.data.selftext,
            author: c.data.author,
            score: c.data.score,
            comments: c.data.num_comments,
            url: `https://reddit.com${c.data.permalink}`,
            created: new Date(c.data.created_utc * 1000).toISOString(),
          })),
          topMentions: ["AAPL"],
          sentimentScore: 0.3,
          bullishCount: 1,
          bearishCount: 0,
          fetchedAt: new Date().toISOString(),
        },
      };
    });

    // Mock web search
    const webEnvelope: WebSearchEnvelope = {
      query: "AAPL news",
      results: [
        {
          title: "AAPL bullish breakout",
          url: "https://reuters.com/aapl",
          snippet: "Apple stock bullish after earnings beat.",
          source: "reuters.com",
          published: "2026-04-11T10:00:00Z",
          category: "news",
        },
      ],
      resultCount: 1,
      fetchedAt: "2026-04-11T12:00:00Z",
      provider: "ddg",
    };
    const webResult: ProviderResult<WebSearchEnvelope> = { status: "ok", data: webEnvelope };
    mockedSearchWeb.mockResolvedValue(webResult);

    const result = await sentimentSummaryTool.execute("call-1", { query: "AAPL" });
    const text = result.content[0].text;

    expect(text).toContain("Sentiment summary");
    expect(text).toContain("AAPL");
    expect(text).toContain("Aggregate");
    expect(text).toContain("Source");
    expect(text).toContain("Score");
    expect(text).toContain("Findings:");
    expect(text).toContain("Price context: unavailable for AAPL");
    expect(text).toMatch(/\bsource-coverage risk\b/i);
    expect(text).toMatch(/\bsentiment can be noisy\b/i);
    expect(text).not.toContain("[OPENCANDLE_EXTERNAL_TOOL_REQUIRED");
    expect(result.details.insight.sampleSize).toBeGreaterThan(0);
    expect(result.details.insight.caveats.join(" ")).toContain("Source warning: Twitter");
    expect(result.details.insight.caveats.join(" ")).not.toContain(
      "[OPENCANDLE_EXTERNAL_TOOL_REQUIRED",
    );
  });

  it("honors saved external-tool skip preferences before fetching aggregate sources", async () => {
    const home = mkdtempSync(join(tmpdir(), "opencandle-summary-skip-"));
    vi.stubEnv("OPENCANDLE_HOME", home);
    const skippedTwitter = markProviderNeverAsk(getDefaultOnboardingState(), "twitter");
    saveOnboardingState(markProviderNeverAsk(skippedTwitter, "reddit"));
    mockedSearchWeb.mockResolvedValue({
      status: "ok",
      data: {
        query: "AAPL",
        results: [
          {
            title: "AAPL bullish",
            url: "https://example.com/aapl",
            snippet: "AAPL sentiment is bullish after demand improved.",
            source: "example.com",
            published: null,
            category: "news",
          },
        ],
        resultCount: 1,
        fetchedAt: "2026-05-21T12:00:00Z",
        provider: "exa",
      },
    } as any);

    const result = await sentimentSummaryTool.execute("call-skip", { query: "AAPL" });
    const text = result.content[0].text;

    expect(mockedWrapProvider).not.toHaveBeenCalled();
    expect(text).toContain("Sentiment summary");
    expect(result.details.insight.caveats.join(" ")).toContain("Twitter");
    expect(result.details.insight.caveats.join(" ")).toContain("Reddit");

    rmSync(home, { recursive: true, force: true });
  });

  it("uses source-specific setup prompts when external tools are unavailable", async () => {
    mockedWrapProvider.mockImplementation(async (provider) => {
      if (provider === "twitter") {
        return {
          status: "unavailable",
          reason: "twitter-cli is not installed. Install it with: uv tool install twitter-cli",
        } as any;
      }
      return { status: "unavailable", reason: "No Reddit session found" } as any;
    });
    mockedSearchWeb.mockResolvedValue({
      status: "ok",
      data: {
        query: "AAPL",
        results: [
          {
            title: "AAPL bullish demand",
            url: "https://example.com/aapl",
            snippet: "AAPL sentiment is bullish after demand improved.",
            source: "example.com",
            published: null,
            category: "news",
          },
        ],
        resultCount: 1,
        fetchedAt: "2026-05-21T12:00:00Z",
        provider: "exa",
      },
    } as any);
    const askUserHandler: AskUserHandler = vi.fn(async (prompt) => ({
      answer: prompt.options?.find((option) => option.includes("Skip")) ?? "Skip X/Twitter once",
      cancelled: false,
    }));

    const setupAwareSummaryTool = createSentimentSummaryTool({ askUserHandler });

    const result = await setupAwareSummaryTool.execute("call-setup", { query: "AAPL" });
    const text = result.content[0].text;

    expect(askUserHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        questionType: "select",
        options: expect.arrayContaining(["Continue after installing twitter-cli"]),
      }),
    );
    expect(text).toContain("Sentiment summary");
    expect(text).toContain("Twitter");
    expect(text).toContain("Reddit");
    expect(text).toContain("Web/News");
  });

  it("keeps Reddit search results for natural-language ticker queries", async () => {
    mockedWrapProvider.mockImplementation(async (provider) => {
      if (provider === "twitter") {
        return { status: "unavailable", reason: "No Twitter session found" } as any;
      }
      return {
        status: "ok",
        data: {
          subreddit: "stocks",
          postCount: 1,
          posts: [
            {
              id: "gme1",
              title: "GME traders lean bullish into the close",
              selftext: "The setup looks constructive after retail buying picked up.",
              author: "retail_bull",
              score: 120,
              comments: 1,
              url: "https://reddit.com/r/stocks/comments/gme1/gme/",
              created: "2026-05-21T12:00:00.000Z",
            },
          ],
          topMentions: ["GME"],
          sentimentScore: 1,
          bullishCount: 1,
          bearishCount: 0,
          fetchedAt: "2026-05-21T12:00:00.000Z",
        },
      };
    });
    mockedGetPostComments.mockResolvedValue([
      {
        id: "gme-comment-1",
        body: "GME still has bearish dilution risk despite the bullish retail bid.",
        author: "risk_watch",
        score: 45,
        permalink: "https://reddit.com/r/stocks/comments/gme1/comment/gme-comment-1/",
      },
    ]);
    mockedSearchWeb.mockResolvedValue({
      status: "ok",
      data: {
        query: "retail mood around GME right now",
        results: [],
        resultCount: 0,
        fetchedAt: "2026-05-21T12:00:00Z",
        provider: "exa",
      },
    } as any);

    const result = await sentimentSummaryTool.execute("call-natural-reddit", {
      query: "retail mood around GME right now",
    });

    expect(result.content[0].text).toContain("Reddit");
    expect(result.details.insight.sampleSize).toBeGreaterThan(1);
  });

  it("adds price context for ticker-specific sentiment summaries", async () => {
    mockedWrapProvider.mockResolvedValue({ status: "unavailable", reason: "disabled" } as any);
    mockedSearchWeb.mockResolvedValue({
      status: "ok",
      data: {
        query: "XYZ",
        results: [
          {
            title: "XYZ bullish",
            url: "https://example.com/xyz",
            snippet: "XYZ stock bullish after strong demand.",
            source: "example.com",
            published: null,
            category: "news",
          },
        ],
        resultCount: 1,
        fetchedAt: "2026-05-21T12:00:00Z",
        provider: "exa",
      },
    } as any);
    mockedGetQuote.mockResolvedValue({
      symbol: "XYZ",
      price: 625,
      change: -5,
      changePercent: -0.8,
      open: 630,
      high: 632,
      low: 620,
      volume: 12_000_000,
      previousClose: 630,
      marketCap: 1_500_000_000_000,
      week52High: 700,
      week52Low: 450,
    } as any);

    const result = await sentimentSummaryTool.execute("call-price", { query: "XYZ" });
    const text = result.content[0].text;

    expect(mockedGetQuote).toHaveBeenCalledWith("XYZ");
    expect(text).toContain("Price context");
    expect(text).toContain("XYZ: $625.00 (-0.80%)");
    expect(text).toContain("positive sentiment signal diverges from price action");
  });

  it("marks stale weekend quote context as last trading-session data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T15:00:00Z"));
    mockedWrapProvider.mockResolvedValue({ status: "unavailable", reason: "disabled" } as any);
    mockedSearchWeb.mockResolvedValue({
      status: "ok",
      data: {
        query: "GME",
        results: [
          {
            title: "GME update",
            url: "https://example.com/gme",
            snippet: "GME shares were quiet after recent news.",
            source: "example.com",
            published: null,
            category: "news",
          },
        ],
        resultCount: 1,
        fetchedAt: "2026-05-23T12:00:00Z",
        provider: "exa",
      },
    } as any);
    mockedGetQuote.mockResolvedValue({
      symbol: "GME",
      price: 21.96,
      change: -0.53,
      changePercent: -2.36,
      open: 22.3,
      high: 22.4,
      low: 21.8,
      volume: 4_000_000,
      previousClose: 22.49,
      marketCap: 10_000_000_000,
      week52High: 35,
      week52Low: 18,
      timestamp: Date.parse("2026-05-22T20:00:00Z"),
    } as any);

    const result = await sentimentSummaryTool.execute("call-weekend", { query: "GME" });
    const text = result.content[0].text;

    expect(text).toContain("Last available quote timestamp");
    expect(text).toContain("U.S. markets are closed today");
    expect(text).toContain("last trading-session price action");
  });

  it("marks same-day weekend quote context as market-closed data", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T15:00:00Z"));
    mockedWrapProvider.mockResolvedValue({ status: "unavailable", reason: "disabled" } as any);
    mockedSearchWeb.mockResolvedValue({
      status: "ok",
      data: {
        query: "GME",
        results: [
          {
            title: "GME update",
            url: "https://example.com/gme",
            snippet: "GME shares were quiet after recent news.",
            source: "example.com",
            published: null,
            category: "news",
          },
        ],
        resultCount: 1,
        fetchedAt: "2026-05-23T12:00:00Z",
        provider: "exa",
      },
    } as any);
    mockedGetQuote.mockResolvedValue({
      symbol: "GME",
      price: 21.96,
      change: -0.53,
      changePercent: -2.36,
      open: 22.3,
      high: 22.4,
      low: 21.8,
      volume: 4_000_000,
      previousClose: 22.49,
      marketCap: 10_000_000_000,
      week52High: 35,
      week52Low: 18,
      timestamp: Date.parse("2026-05-23T15:05:00Z"),
    } as any);

    const result = await sentimentSummaryTool.execute("call-weekend-same-day", { query: "GME" });
    const text = result.content[0].text;

    expect(text).toContain("Quote timestamp");
    expect(text).toContain("U.S. markets are closed today");
    expect(text).toContain("not active intraday trading");
  });

  it("does not add ticker price context for broad topic sentiment summaries", async () => {
    mockedWrapProvider.mockResolvedValue({ status: "unavailable", reason: "disabled" } as any);
    mockedSearchWeb.mockResolvedValue({
      status: "ok",
      data: {
        query: "semiconductor sector sentiment",
        results: [
          {
            title: "Semiconductor demand improves",
            url: "https://example.com/semis",
            snippet: "Semiconductor sector sentiment is improving after stronger orders.",
            source: "example.com",
            published: null,
            category: "news",
          },
        ],
        resultCount: 1,
        fetchedAt: "2026-05-21T12:00:00Z",
        provider: "exa",
      },
    } as any);

    const result = await sentimentSummaryTool.execute("call-topic", {
      query: "semiconductor sector sentiment",
    });
    const text = result.content[0].text;

    expect(mockedGetQuote).not.toHaveBeenCalled();
    expect(text).not.toContain("Price context");
    expect(text).toContain("Source-coverage risk");
  });

  it("handles all sources unavailable", async () => {
    // All providers unavailable via wrapProvider mock
    mockedWrapProvider.mockResolvedValue({ status: "unavailable", reason: "service down" } as any);
    mockedSearchWeb.mockResolvedValue({ status: "unavailable", reason: "failed" } as any);

    const result = await sentimentSummaryTool.execute("call-2", { query: "XYZ" });
    expect(result.content[0].text).toContain("unavailable");
  });

  it("includes Finnhub in output when API key is configured and ticker query", async () => {
    mockedGetConfig.mockReturnValue({ finnhubApiKey: "test-key" } as any);

    // Mock Finnhub returning articles
    mockedGetCompanyNews.mockResolvedValue([
      {
        headline: "Apple beats earnings",
        summary: "Apple Inc reported record revenue for Q1.",
        source: "Reuters",
        datetime: 1775943540,
        url: "https://finnhub.io/api/news?id=test1",
        related: "AAPL",
        id: 12345,
        category: "company",
        image: "",
      },
    ]);

    // Mock other sources
    mockedWrapProvider.mockResolvedValue({ status: "unavailable", reason: "disabled" } as any);
    mockedSearchWeb.mockResolvedValue({ status: "unavailable", reason: "disabled" } as any);

    const result = await sentimentSummaryTool.execute("call-3", { query: "AAPL" });
    const text = result.content[0].text;

    expect(text).toContain("Finnhub");
    expect(text).toContain("Sentiment summary");
  });

  it("does not fetch Finnhub when no API key is configured, but emits a soft-degraded tag", async () => {
    // 7.6/7.7 — when the user has no Finnhub key but the query has tickers
    // Finnhub could have served, the tool must NOT call `getCompanyNews` AND
    // must include a `[OPENCANDLE_SOFT_DEGRADED provider=finnhub ...]` tag
    // in the content so the extension's degradation accumulator picks it
    // up for the turn-end gap note.
    mockedGetConfig.mockReturnValue({} as any);

    // Mock other sources with some data
    mockedWrapProvider.mockResolvedValue({ status: "unavailable", reason: "disabled" } as any);
    const webEnvelope: WebSearchEnvelope = {
      query: "AAPL",
      results: [
        {
          title: "Test",
          url: "https://test.com",
          snippet: "bullish AAPL",
          source: "test.com",
          published: null,
          category: "news" as const,
        },
      ],
      resultCount: 1,
      fetchedAt: new Date().toISOString(),
      provider: "exa",
    };
    mockedSearchWeb.mockResolvedValue({ status: "ok", data: webEnvelope } as any);

    const result = await sentimentSummaryTool.execute("call-4", { query: "AAPL" });
    const text = result.content[0].text;

    // Finnhub was not fetched …
    expect(mockedGetCompanyNews).not.toHaveBeenCalled();
    // … and there is no Finnhub data row in the per-source table.
    expect(text).not.toMatch(/\|\s*Finnhub\s*\|/);
    // … but the soft-degraded tag is emitted so the extension records it.
    expect(text).toContain("[OPENCANDLE_SOFT_DEGRADED");
    expect(text).toContain("provider=finnhub");
  });

  it("does not emit a Finnhub soft-degraded tag when the query has no finnhub-mappable ticker", async () => {
    mockedGetConfig.mockReturnValue({} as any);

    mockedWrapProvider.mockResolvedValue({ status: "unavailable", reason: "disabled" } as any);
    const webEnvelope: WebSearchEnvelope = {
      query: "market sentiment",
      results: [
        {
          title: "Test",
          url: "https://test.com",
          snippet: "markets up today",
          source: "test.com",
          published: null,
          category: "news" as const,
        },
      ],
      resultCount: 1,
      fetchedAt: new Date().toISOString(),
      provider: "exa",
    };
    mockedSearchWeb.mockResolvedValue({ status: "ok", data: webEnvelope } as any);

    const result = await sentimentSummaryTool.execute("call-5", {
      query: "market sentiment",
    });
    const text = result.content[0].text;

    expect(text).not.toContain("provider=finnhub");
  });
});
