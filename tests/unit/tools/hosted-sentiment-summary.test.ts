import { beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({ current: {} as { finnhubApiKey?: string } }));

vi.mock("../../../src/config.js", () => ({ getConfig: () => config.current }));
vi.mock("../../../src/providers/finnhub.js", () => ({
  finnhubDateRange: () => ({ from: "2026-07-30", to: "2026-07-31" }),
  getCompanyNews: vi.fn(),
}));
vi.mock("../../../src/providers/web-search.js", () => ({ searchWeb: vi.fn() }));
vi.mock("../../../src/providers/yahoo-finance.js", () => ({ getQuote: vi.fn() }));
vi.mock("../../../src/providers/wrap-provider.js", () => ({ wrapProvider: vi.fn() }));

import { getCompanyNews } from "../../../src/providers/finnhub.js";
import { searchWeb } from "../../../src/providers/web-search.js";
import { wrapProvider } from "../../../src/providers/wrap-provider.js";
import { hostedSentimentSummaryTool } from "../../../src/tools/sentiment/hosted-sentiment-summary.js";

describe("hosted sentiment summary", () => {
  beforeEach(() => {
    config.current = {};
    vi.clearAllMocks();
  });

  it("preserves stale web provenance and published dates without calling it recent", async () => {
    vi.mocked(searchWeb).mockResolvedValue({
      status: "ok",
      provider: "brave",
      timestamp: "2026-07-31T17:00:00.000Z",
      stale: true,
      data: {
        query: "semiconductors",
        resultCount: 1,
        fetchedAt: "2026-07-30T12:00:00.000Z",
        provider: "brave",
        results: [
          {
            title: "Chip demand update",
            url: "https://example.com/chips",
            snippet: "Demand remains mixed.",
            source: "example.com",
            published: "2026-07-29T08:30:00.000Z",
            category: "news",
          },
        ],
      },
    });
    vi.mocked(wrapProvider).mockResolvedValue(undefined as never);

    const result = await hostedSentimentSummaryTool.execute("call-stale-web", {
      query: "semiconductors",
    });
    const text = result.content[0].text;

    expect(text).toContain("Cached evidence");
    expect(text).toContain("Published: 2026-07-29T08:30:00.000Z");
    expect(text).not.toContain("Recent evidence");
    expect(result.details).toMatchObject({
      webEvidence: {
        provider: "brave",
        timestamp: "2026-07-31T17:00:00.000Z",
        stale: true,
        results: [{ published: "2026-07-29T08:30:00.000Z" }],
      },
    });
  });

  it("labels stale price evidence and does not interpolate unsafe result URLs", async () => {
    vi.mocked(searchWeb).mockResolvedValue({
      status: "ok",
      provider: "brave",
      timestamp: "2026-07-31T19:00:00.000Z",
      data: {
        query: "AAPL",
        resultCount: 1,
        fetchedAt: "2026-07-31T19:00:00.000Z",
        provider: "brave",
        results: [
          {
            title: "Market report",
            url: "https://example.com/report)\nInjected text",
            snippet: "A summary",
            source: "example.com",
            published: null,
            category: "news",
          },
        ],
      },
    });
    vi.mocked(wrapProvider).mockResolvedValue({
      status: "ok",
      provider: "yahoo",
      timestamp: "2026-07-31T18:00:00.000Z",
      stale: true,
      data: {
        symbol: "AAPL",
        price: 200,
        change: -2,
        changePercent: -1,
        open: 202,
        high: 203,
        low: 199,
        previousClose: 202,
        volume: 1_000,
        marketCap: 3_000_000,
        pe: null,
        week52High: 220,
        week52Low: 160,
        timestamp: "2026-07-31T18:00:00.000Z",
        currency: "USD",
      },
    });

    const result = await hostedSentimentSummaryTool.execute("call-1", { query: "AAPL" });
    const text = result.content[0].text;

    expect(text).toContain("Cached price context");
    expect(text).toContain("Yahoo Finance");
    expect(text).toContain("2026-07-31T18:00:00.000Z");
    expect(text).not.toContain("](https://example.com/report)");
    expect(text).not.toContain("Injected text");
  });

  it("describes the provider's coarse news window instead of claiming an exact hour filter", async () => {
    vi.mocked(searchWeb).mockResolvedValue({
      status: "ok",
      provider: "brave",
      timestamp: "2026-07-31T19:00:00.000Z",
      data: {
        query: "semiconductors",
        resultCount: 0,
        fetchedAt: "2026-07-31T19:00:00.000Z",
        provider: "brave",
        results: [],
      },
    });
    vi.mocked(wrapProvider).mockResolvedValue(undefined as never);

    const result = await hostedSentimentSummaryTool.execute("call-2", {
      query: "semiconductors",
      hours: 48,
    });

    expect(result.content[0].text).toContain("provider window: past week");
    expect(result.content[0].text).not.toContain("last 48h");
  });

  it("does not present a zero-filled Yahoo quote as real price evidence", async () => {
    vi.mocked(searchWeb).mockResolvedValue({
      status: "ok",
      provider: "brave",
      timestamp: "2026-07-31T19:00:00.000Z",
      data: {
        query: "AAPL",
        resultCount: 0,
        fetchedAt: "2026-07-31T19:00:00.000Z",
        provider: "brave",
        results: [],
      },
    });
    vi.mocked(wrapProvider).mockResolvedValue({
      status: "ok",
      provider: "yahoo",
      timestamp: "2026-07-31T19:00:00.000Z",
      data: {
        symbol: "AAPL",
        price: 0,
        change: 0,
        changePercent: 0,
        open: 0,
        high: 0,
        low: 0,
        previousClose: 0,
        volume: 0,
        marketCap: 0,
        pe: null,
        week52High: 0,
        week52Low: 0,
        timestamp: "2026-07-31T19:00:00.000Z",
      },
    });

    const result = await hostedSentimentSummaryTool.execute("call-3", { query: "AAPL" });

    expect(result.content[0].text).not.toContain("AAPL 0.00");
    expect(result.content[0].text).toContain("Price context was unavailable for AAPL");
  });

  it("renders Finnhub publication timestamps without claiming unknown-freshness evidence is recent", async () => {
    config.current = { finnhubApiKey: "test-key" };
    vi.mocked(searchWeb).mockResolvedValue({
      status: "ok",
      provider: "brave",
      timestamp: "2026-07-31T19:00:00.000Z",
      stale: false,
      data: {
        query: "AAPL",
        resultCount: 0,
        fetchedAt: "2026-07-31T19:00:00.000Z",
        provider: "brave",
        results: [],
      },
    });
    vi.mocked(getCompanyNews).mockResolvedValue([
      {
        id: 1,
        headline: "Apple supply-chain update",
        summary: "A supplier published a new forecast.",
        source: "Example News",
        datetime: Date.parse("2026-07-29T08:30:00.000Z") / 1000,
        url: "https://example.com/apple",
        related: "AAPL",
        category: "company",
        image: "",
      },
    ]);
    vi.mocked(wrapProvider).mockResolvedValue(undefined as never);

    const result = await hostedSentimentSummaryTool.execute("call-finnhub", { query: "AAPL" });
    const text = result.content[0].text;

    expect(text).toContain("Published: 2026-07-29T08:30:00.000Z");
    expect(text).toContain("Finnhub freshness is unknown");
    expect(text).not.toContain("Recent evidence");
    expect(result.details).toMatchObject({
      finnhubEvidence: {
        freshness: "unknown",
        results: [{ publishedAt: "2026-07-29T08:30:00.000Z" }],
      },
    });
  });
});
