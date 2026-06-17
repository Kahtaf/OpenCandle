import { describe, expect, it } from "vitest";
import type { SentinelRecord } from "../../../src/sentiment/types.js";
import {
  recordMatchesSentimentQuery,
  sentimentQueryTerms,
} from "../../../src/tools/sentiment/query-match.js";

function record(
  title: string,
  text = "",
  tickers: string[] = [],
  metadata: Record<string, unknown> = {},
): SentinelRecord {
  return {
    id: title,
    source: "reddit",
    sourceId: title,
    query: "test",
    title,
    text,
    author: null,
    url: "",
    publishedAt: null,
    fetchedAt: "2026-05-21T12:00:00.000Z",
    engagement: { score: 0, replies: 0, shares: null, views: null },
    sentiment: { score: 0, confidence: 0, method: "keyword", tickers },
    metadata,
  };
}

describe("sentiment query matching", () => {
  it("keeps extracted ticker terms from natural-language queries", () => {
    const terms = sentimentQueryTerms("retail mood around GME right now");

    expect(terms).toEqual(["gme"]);
    expect(recordMatchesSentimentQuery(record("GME traders lean bullish"), terms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("AAPL earnings thread"), terms)).toBe(false);
  });

  it("does not require incidental prompt words for natural-language ticker queries", () => {
    const peopleTerms = sentimentQueryTerms("what are people saying about NVDA");
    const latestTerms = sentimentQueryTerms("latest sentiment on AAPL");
    const twitterTerms = sentimentQueryTerms("what's twitter saying about SPCX");

    expect(peopleTerms).toEqual(["nvda"]);
    expect(latestTerms).toEqual(["aapl"]);
    expect(twitterTerms).toEqual(["spcx"]);
    expect(recordMatchesSentimentQuery(record("NVDA traders lean bullish"), peopleTerms)).toBe(
      true,
    );
    expect(recordMatchesSentimentQuery(record("AAPL earnings thread"), latestTerms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("SPCX launch discussion"), twitterTerms)).toBe(true);
  });

  it("keeps topic qualifiers with ticker queries", () => {
    const terms = sentimentQueryTerms("AAPL layoffs");

    expect(terms).toEqual(["aapl", "layoffs"]);
    expect(recordMatchesSentimentQuery(record("AAPL layoffs accelerate"), terms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("AAPL earnings thread"), terms)).toBe(false);
  });

  it("matches ticker-like terms on token boundaries", () => {
    const terms = ["cat"];

    expect(recordMatchesSentimentQuery(record("CAT industrial demand improves"), terms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("Semiconductor catalyst watch"), terms)).toBe(false);
    expect(recordMatchesSentimentQuery(record("Cats trading thread"), terms)).toBe(false);
  });

  it("matches punctuated class-share ticker spellings", () => {
    const terms = sentimentQueryTerms("BRK.B sentiment");

    expect(terms).toEqual(["brkb"]);
    expect(recordMatchesSentimentQuery(record("BRK.B valuation thread"), terms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("BRK-B valuation thread"), terms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("Berkshire holders", "", ["BRK.B"]), terms)).toBe(
      true,
    );
  });

  it("matches common S&P 500 spellings", () => {
    const terms = sentimentQueryTerms("S&P 500 sentiment");

    expect(terms).toEqual(["sp500"]);
    expect(recordMatchesSentimentQuery(record("S&P 500 rally broadens"), terms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("SPX breadth improves"), terms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("Small-cap rally broadens"), terms)).toBe(false);
  });

  it("keeps topic qualifiers with S&P 500 queries", () => {
    const terms = sentimentQueryTerms("SPX bearish options flow");

    expect(terms).toEqual(["sp500", "bearish", "options", "flow"]);
    expect(recordMatchesSentimentQuery(record("SPX bearish options flow expands"), terms)).toBe(
      true,
    );
    expect(recordMatchesSentimentQuery(record("S&P 500 rally broadens"), terms)).toBe(false);
  });

  it("matches punctuation-bearing finance topics", () => {
    const mergerTerms = sentimentQueryTerms("M&A");
    const valuationTerms = sentimentQueryTerms("P/E");
    const qualifiedMergerTerms = sentimentQueryTerms("M&A deals");

    expect(mergerTerms).toEqual(["ma"]);
    expect(valuationTerms).toEqual(["pe"]);
    expect(qualifiedMergerTerms).toEqual(["ma", "deals"]);
    expect(recordMatchesSentimentQuery(record("M&A deal activity rises"), mergerTerms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("M&A deals rebound"), qualifiedMergerTerms)).toBe(
      true,
    );
    expect(
      recordMatchesSentimentQuery(record("Software deals rebound"), qualifiedMergerTerms),
    ).toBe(false);
    expect(recordMatchesSentimentQuery(record("P/E multiples compress"), valuationTerms)).toBe(
      true,
    );
    expect(recordMatchesSentimentQuery(record("Momentum trade update"), mergerTerms)).toBe(false);
  });

  it("preserves meaningful short topic terms", () => {
    const terms = sentimentQueryTerms("AI sentiment");

    expect(terms).toContain("ai");
    expect(recordMatchesSentimentQuery(record("AI capex is back"), terms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("Retail gains broaden"), terms)).toBe(false);
    expect(recordMatchesSentimentQuery(record("EV deliveries improve"), terms)).toBe(false);
  });

  it("does not match all records when no usable term remains", () => {
    const terms = sentimentQueryTerms("what is reddit saying");

    expect(terms).toEqual(["what is reddit saying"]);
    expect(recordMatchesSentimentQuery(record("Unrelated market thread"), terms)).toBe(false);
  });

  it("matches exact phrase fallback terms", () => {
    const terms = sentimentQueryTerms("retail stocks");

    expect(terms).toEqual(["retail stocks"]);
    expect(recordMatchesSentimentQuery(record("Retail stocks rally"), terms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("Retail flows into bonds"), terms)).toBe(false);
  });

  it("requires stronger coverage for multi-term topics", () => {
    const terms = sentimentQueryTerms("bank stress");

    expect(recordMatchesSentimentQuery(record("Bank stress is rising"), terms)).toBe(true);
    expect(recordMatchesSentimentQuery(record("Regional bank dividend thread"), terms)).toBe(false);
  });

  it("counts subreddit metadata for subreddit-qualified ticker queries", () => {
    const terms = sentimentQueryTerms("r/wallstreetbets saying about META");

    expect(terms).toEqual(["meta", "wallstreetbets"]);
    expect(
      recordMatchesSentimentQuery(
        record("META earnings thread", "", ["META"], { subreddit: "wallstreetbets" }),
        terms,
      ),
    ).toBe(true);
    expect(recordMatchesSentimentQuery(record("META earnings thread", "", ["META"]), terms)).toBe(
      false,
    );
  });

  it("matches simple singular and plural topic variants", () => {
    expect(recordMatchesSentimentQuery(record("Tesla layoffs accelerate"), ["layoff"])).toBe(true);
    expect(recordMatchesSentimentQuery(record("Regional banks rally"), ["bank"])).toBe(true);
    expect(recordMatchesSentimentQuery(record("Rate cut odds rise"), ["rates"])).toBe(true);
  });
});
