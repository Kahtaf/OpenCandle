import { describe, expect, it } from "vitest";
import {
  analyzeCompetitiveReport,
  buildComparisonJudgePrompt,
} from "../../evals/competitive-finance.js";

describe("competitive finance planning metadata", () => {
  it("includes planning metadata in the judge prompt", () => {
    const prompt = buildComparisonJudgePrompt({
      prompt: {
        id: "today-move",
        prompt: "Why did BA move today?",
        topic: "current event",
        complexity: "moderate",
        evaluationFocus: "temporal grounding",
      },
      asOfDate: "2026-05-24",
      competitorAnswers: [
        {
          id: "claude",
          label: "Claude",
          provider: "anthropic",
          model: "claude",
          answer: "No live tools.",
        },
      ],
      openCandleTrace: {
        prompt: "Why did BA move today?",
        classification: {
          workflow: "general_finance_qa",
          confidence: 0.9,
          tier: "llm",
          entities: { symbols: ["BA"] },
        },
        toolCalls: [],
        askUserTranscript: [],
        text: "answer",
        planning: {
          version: "planning-v1",
          taskFamily: "current_event_explanation",
          commitmentMode: "framework",
          policyCardId: "current_event_explanation",
          evidencePlanId: "market_status",
          answerContractId: "current_event_explanation",
          structuredCheckIds: ["freshness_disclosed"],
          workspacePlaceholderIds: [],
          artifactPlaceholderIds: [],
          capabilityGapIds: ["market_calendar"],
          evidenceRecords: [],
          structuredCheckFailures: [],
          retryEligibility: { eligible: false, activeRetryAllowed: false, reasons: [] },
        },
      },
    });

    expect(prompt).toContain("OpenCandle planning metadata");
    expect(prompt).toContain("current_event_explanation");
    expect(prompt).toContain("market_status");
  });

  it("classifies competitive improvement ideas by prompt-to-policy layer", () => {
    const analysis = analyzeCompetitiveReport({
      generatedAt: "2026-05-24T00:00:00.000Z",
      results: [
        {
          prompt: {
            id: "case-1",
            prompt: "Compare these ETFs",
            topic: "ETF comparison",
            complexity: "moderate",
            evaluationFocus: "overlap and tradeoffs",
          },
          openCandleTrace: {
            toolCalls: [{ name: "compare_assets", args: {} }],
            planning: {
              taskFamily: "asset_compare",
              evidencePlanId: "placeholder_asset_compare",
              structuredCheckFailures: [{ checkId: "capability_gap_disclosure" }],
              retryEligibility: {
                eligible: true,
                activeRetryAllowed: false,
                reasons: ["capability gap"],
              },
            },
          },
          competitorAnswers: [],
          judgment: {
            winner: "claude",
            openCandleScore: 3,
            competitorScores: { claude: 5 },
            reason: "OpenCandle missed holdings overlap.",
            openCandleDidBetter: [],
            competitorsDidBetter: { claude: ["better synthesis"] },
            openCandleImprovementIdeas: [
              "Add ETF holdings overlap data",
              "Improve answer contract for tradeoff framing",
            ],
          },
        },
      ],
    });

    expect(analysis.cases[0]?.planning?.taskFamily).toBe("asset_compare");
    expect(analysis.cases[0]?.failureClassifications).toEqual(
      expect.arrayContaining(["tool-capability", "answer-contract"]),
    );
    expect(analysis.themeSummary.map((theme) => theme.theme)).toContain("tool-capability");
  });
});
