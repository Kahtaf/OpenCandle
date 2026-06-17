import { describe, expect, it } from "vitest";
import { formatInsightSection } from "../../../src/tools/sentiment/insight-format.js";
import type { SentimentInsight } from "../../../src/types/sentiment.js";

describe("formatInsightSection", () => {
  it("labels representative preview with scored and total sample counts", () => {
    const insight: SentimentInsight = {
      score: 0.25,
      label: "Leaning Bullish",
      confidence: { score: 0.4, level: "medium", reasons: [] },
      sampleSize: 14,
      scoredSampleSize: 4,
      positiveDrivers: [],
      negativeDrivers: [],
      mixedDrivers: [],
      notableClaims: [],
      representativeItems: [
        {
          source: "reddit",
          sourceId: "r1",
          title: "Bullish demand note",
          excerpt: "Demand improved.",
          url: null,
          author: null,
          publishedAt: null,
          engagement: 12,
          score: 0.5,
          matchedTerms: ["bullish"],
        },
      ],
      sourceCoverage: { sources: ["reddit"], counts: { reddit: 14 } },
      caveats: [],
      method: "deterministic-keyword-v1",
    };

    expect(formatInsightSection(insight).join("\n")).toContain(
      "Representative evidence preview: 1 shown from 4 scored records (14 total records).",
    );
  });
});
