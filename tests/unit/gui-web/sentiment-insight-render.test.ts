import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ToolResultCard } from "../../../gui/web/src/features/renderers/ToolResultCard.jsx";

describe("sentiment insight GUI rendering", () => {
  it("distinguishes full scoring sample from representative evidence preview", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolResultCard, {
        message: {
          role: "tool",
          toolName: "get_twitter_sentiment",
          content: [{ type: "text", text: "Twitter sentiment output" }],
          details: {
            query: "$SPCX",
            tweetCount: 14,
            tweets: [],
            sentimentScore: 0.25,
            bullishCount: 5,
            bearishCount: 3,
            topMentions: ["RKLB"],
            fetchedAt: "2026-06-16T13:31:02.259Z",
            insight: {
              label: "Leaning Bullish",
              score: 0.25,
              sampleSize: 14,
              scoredSampleSize: 8,
              confidence: { level: "medium", score: 0.58, reasons: ["mixed source evidence"] },
              positiveDrivers: [
                {
                  label: "breakout",
                  count: 3,
                  polarity: "positive",
                  terms: ["breakout"],
                  sourceIds: ["tweet-1"],
                },
              ],
              negativeDrivers: [
                {
                  label: "overvalued",
                  count: 2,
                  polarity: "negative",
                  terms: ["overvalued"],
                  sourceIds: ["tweet-2"],
                },
              ],
              mixedDrivers: [],
              notableClaims: [],
              representativeItems: [
                {
                  source: "twitter",
                  sourceId: "tweet-1",
                  title: null,
                  excerpt: "SPCX breakout chatter",
                  url: "https://x.com/a/status/1",
                  author: "trader",
                  publishedAt: "2026-06-16T13:00:00.000Z",
                  engagement: 4,
                  score: 1,
                  matchedTerms: ["breakout"],
                },
                {
                  source: "twitter",
                  sourceId: "tweet-2",
                  title: null,
                  excerpt: "SPCX valuation pushback",
                  url: "https://x.com/b/status/2",
                  author: "bear",
                  publishedAt: "2026-06-16T13:05:00.000Z",
                  engagement: 2,
                  score: -1,
                  matchedTerms: ["overvalued"],
                },
              ],
              sourceCoverage: { sources: ["twitter"], counts: { twitter: 14 } },
              caveats: ["Single-source sentiment coverage."],
              method: "deterministic-keyword-v1",
            },
          },
        },
      }),
    );

    expect(html).toContain("Findings");
    expect(html).toContain("medium confidence");
    expect(html).toContain("Scored sample");
    expect(html).toContain("14");
    expect(html).toContain("Preview shown");
    expect(html).toContain("2");
    expect(html).toContain("Source evidence: breakout");
    expect(html).toContain(
      "Representative evidence preview: 2 shown from 8 scored records (14 total records).",
    );
  });

  it("renders sentiment summary insights without legacy score fields", () => {
    const html = renderToStaticMarkup(
      React.createElement(ToolResultCard, {
        message: {
          role: "tool",
          toolName: "get_sentiment_summary",
          content: [{ type: "text", text: "Sentiment summary output" }],
          details: {
            fresh: [],
            trend: [],
            divergence: null,
            warnings: [],
            insight: {
              label: "Leaning Bullish",
              score: 0.22,
              sampleSize: 14,
              scoredSampleSize: 9,
              confidence: { level: "medium", score: 0.6, reasons: ["cross-source support"] },
              positiveDrivers: [
                {
                  label: "demand",
                  count: 4,
                  polarity: "positive",
                  terms: ["demand"],
                  sourceIds: ["record-1"],
                },
              ],
              negativeDrivers: [],
              mixedDrivers: [],
              notableClaims: [],
              representativeItems: [],
              sourceCoverage: { sources: ["reddit", "twitter"], counts: { reddit: 7, twitter: 7 } },
              caveats: [],
              method: "deterministic-keyword-v1",
            },
          },
        },
      }),
    );

    expect(html).toContain("Findings");
    expect(html).toContain("medium confidence");
    expect(html).toContain("Source evidence: demand");
    expect(html).toContain("Sentiment summary output");
  });
});
