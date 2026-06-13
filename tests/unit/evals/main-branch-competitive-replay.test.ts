import { describe, expect, it } from "vitest";
import {
  buildCompetitiveReplayComparison,
  summarizeCompetitiveReplayReport,
  unsupportedCompetitiveReplayRun,
} from "../../evals/main-branch-competitive-replay.js";

describe("main branch competitive replay", () => {
  it("compares current and base competitive reports by fixed prompt", () => {
    const base = summarizeCompetitiveReplayReport({
      ref: "origin/main",
      reportPath: "runs/base_competitive-finance.json",
      report: competitiveReport({
        generatedAt: "2026-05-25T10:00:00.000Z",
        cases: [
          {
            id: "inflation-impact-3",
            prompt: "How does inflation affect cash?",
            winner: "claude",
            openCandleScore: 4,
            competitorScores: { claude: 5, codex: 3 },
            planning: {
              taskFamily: "general_fallback",
              evidencePlanId: "placeholder_general_fallback",
            },
            cachedCompetitors: ["claude", "codex"],
          },
        ],
      }),
    });
    const current = summarizeCompetitiveReplayReport({
      ref: "HEAD",
      reportPath: "runs/current_competitive-finance.json",
      report: competitiveReport({
        generatedAt: "2026-05-25T11:00:00.000Z",
        cases: [
          {
            id: "inflation-impact-3",
            prompt: "How does inflation affect cash?",
            winner: "opencandle",
            openCandleScore: 5,
            competitorScores: { claude: 4, codex: 3 },
            planning: {
              taskFamily: "concept_explainer",
              evidencePlanId: "placeholder_concept_explainer",
            },
            cachedCompetitors: ["claude", "codex"],
          },
        ],
      }),
    });

    const comparison = buildCompetitiveReplayComparison({
      current,
      base,
      generatedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(comparison.status).toBe("compared");
    expect(comparison.openCandleWinDelta).toBe(1);
    expect(comparison.lossDelta).toBe(-1);
    expect(comparison.caseChanges).toEqual([
      expect.objectContaining({
        id: "inflation-impact-3",
        status: "improved",
        baseOpenCandleScore: 4,
        currentOpenCandleScore: 5,
        scoreDelta: 1,
        baseWinner: "claude",
        currentWinner: "opencandle",
        cachedCompetitors: ["claude", "codex"],
        basePlanning: expect.objectContaining({ taskFamily: "general_fallback" }),
        currentPlanning: expect.objectContaining({ taskFamily: "concept_explainer" }),
      }),
    ]);
  });

  it("records unsupported competitive replay without counting it as a win", () => {
    const current = summarizeCompetitiveReplayReport({
      ref: "HEAD",
      reportPath: "runs/current_competitive-finance.json",
      report: competitiveReport({
        generatedAt: "2026-05-25T11:00:00.000Z",
        cases: [
          {
            id: "portfolio-rebalance-2",
            prompt: "Should I rebalance this portfolio?",
            winner: "opencandle",
            openCandleScore: 5,
            competitorScores: { claude: 4 },
            planning: {
              taskFamily: "portfolio_review",
              evidencePlanId: "placeholder_portfolio_review",
            },
            cachedCompetitors: ["claude"],
          },
        ],
      }),
    });

    const comparison = buildCompetitiveReplayComparison({
      current,
      base: unsupportedCompetitiveReplayRun(
        "origin/main",
        "base ref cannot run competitive reports",
      ),
      generatedAt: "2026-05-25T12:00:00.000Z",
    });

    expect(comparison.status).toBe("unsupported");
    expect(comparison.caseChanges).toEqual([]);
    expect(comparison.unsupportedReason).toBe("base ref cannot run competitive reports");
    expect(comparison.openCandleWinDelta).toBeUndefined();
  });
});

function competitiveReport(input: {
  generatedAt: string;
  cases: Array<{
    id: string;
    prompt: string;
    winner: string;
    openCandleScore: number;
    competitorScores: Record<string, number>;
    planning: { taskFamily: string; evidencePlanId: string };
    cachedCompetitors: string[];
  }>;
}) {
  return {
    generatedAt: input.generatedAt,
    results: input.cases.map((entry) => ({
      prompt: {
        id: entry.id,
        prompt: entry.prompt,
        topic: "fixed prompt",
        complexity: "moderate",
        evaluationFocus: "compare current and base",
      },
      openCandleTrace: {
        planning: entry.planning,
        toolCalls: [],
      },
      competitorAnswers: entry.cachedCompetitors.map((id) => ({
        id,
        label: id,
        provider: "fixture",
        model: "fixture",
        answer: `${id} answer`,
        cachedFromReport: "fixture-report.json",
      })),
      judgment: {
        winner: entry.winner,
        openCandleScore: entry.openCandleScore,
        competitorScores: entry.competitorScores,
        reason: "fixture judgment",
        openCandleDidBetter: [],
        competitorsDidBetter: {},
        openCandleImprovementIdeas: [],
      },
    })),
  };
}
