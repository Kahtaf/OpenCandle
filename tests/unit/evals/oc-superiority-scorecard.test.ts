import { describe, expect, it } from "vitest";
import type { CompetitiveReplayComparison } from "../../evals/main-branch-competitive-replay.js";
import type { ProductReplayComparison } from "../../evals/main-branch-replay.js";
import { buildOcSuperiorityScorecard } from "../../evals/oc-superiority-scorecard.js";

describe("OpenCandle superiority scorecard", () => {
  it("classifies a branch as better than main when replay improves and architecture signals are present", () => {
    const scorecard = buildOcSuperiorityScorecard({
      generatedAt: "2026-05-25T12:00:00.000Z",
      productReplay: productReplay({ aggregateDelta: 2, passDelta: 1 }),
      competitiveReplay: competitiveReplay({
        openCandleWinDelta: 1,
        lossDelta: -1,
        regressed: false,
      }),
      promptPolicy: promptPolicy({
        failed: 0,
        artifactContracts: ["portfolio_exposure_map"],
        structuredFailures: [],
      }),
    });

    expect(scorecard.status).toBe("better_than_main");
    expect(scorecard.blockers).toEqual([]);
    expect(scorecard.layers.productReplay.status).toBe("pass");
    expect(scorecard.layers.competitiveReplay.status).toBe("pass");
    expect(scorecard.layers.promptPolicy.status).toBe("pass");
    expect(scorecard.layers.architectureSignals.status).toBe("pass");
    expect(scorecard.improvements).toEqual(
      expect.arrayContaining([
        expect.stringContaining("product replay"),
        expect.stringContaining("competitive replay"),
      ]),
    );
  });

  it("classifies blocking regressions explicitly", () => {
    const scorecard = buildOcSuperiorityScorecard({
      generatedAt: "2026-05-25T12:00:00.000Z",
      productReplay: productReplay({ aggregateDelta: -1, passDelta: 0 }),
      competitiveReplay: competitiveReplay({
        openCandleWinDelta: 0,
        lossDelta: 1,
        regressed: true,
      }),
      promptPolicy: promptPolicy({
        failed: 1,
        artifactContracts: [],
        evidenceTypes: [],
        structuredFailures: ["target_bands_present"],
      }),
    });

    expect(scorecard.status).toBe("below_main_parity");
    expect(scorecard.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ layer: "productReplay" }),
        expect.objectContaining({ layer: "competitiveReplay" }),
        expect.objectContaining({ layer: "promptPolicy" }),
        expect.objectContaining({ layer: "architectureSignals" }),
      ]),
    );
  });

  it("reports observe-only structured failures without making architecture signals a blocker", () => {
    const scorecard = buildOcSuperiorityScorecard({
      generatedAt: "2026-05-25T12:00:00.000Z",
      productReplay: productReplay({ aggregateDelta: 0, passDelta: 0 }),
      competitiveReplay: competitiveReplay({
        openCandleWinDelta: 0,
        lossDelta: 0,
        regressed: false,
      }),
      promptPolicy: promptPolicy({
        failed: 0,
        artifactContracts: ["portfolio_exposure_map"],
        evidenceTypes: ["portfolio_exposure_map"],
        structuredFailures: ["assumption_disclosed"],
      }),
    });

    expect(scorecard.status).toBe("at_main_parity");
    expect(scorecard.blockers.map((blocker) => blocker.layer)).not.toContain("architectureSignals");
    expect(scorecard.layers.architectureSignals.reasons).toContain(
      "observe-only structured check failures observed: assumption_disclosed",
    );
    expect(scorecard.layers.architectureSignals.reasons).toContain(
      "structured diagnostics use regex-inferred final-answer metadata; keep them observe-only until typed metadata is available",
    );
  });

  it("blocks when prompt section budgets exceed the migration ceiling", () => {
    const scorecard = buildOcSuperiorityScorecard({
      generatedAt: "2026-05-25T12:00:00.000Z",
      productReplay: productReplay({ aggregateDelta: 0, passDelta: 0 }),
      competitiveReplay: competitiveReplay({
        openCandleWinDelta: 0,
        lossDelta: 0,
        regressed: false,
      }),
      promptPolicy: promptPolicy({
        failed: 0,
        artifactContracts: ["portfolio_exposure_map"],
        structuredFailures: [],
        promptBudget: { totalSectionBudget: 32_000, ceiling: 31_500 },
      }),
    });

    expect(scorecard.status).toBe("below_main_parity");
    expect(scorecard.blockers).toContainEqual(
      expect.objectContaining({
        layer: "architectureSignals",
        reason: "prompt section budget 32000 exceeds ceiling 31500",
      }),
    );
  });
});

function productReplay(input: {
  aggregateDelta: number;
  passDelta: number;
}): ProductReplayComparison {
  return {
    generatedAt: "2026-05-25T11:00:00.000Z",
    evalMode: "product",
    status: "compared",
    current: {
      status: "ok",
      ref: "HEAD",
      reportPath: "current-product.json",
      generatedAt: "2026-05-25T11:00:00.000Z",
      caseCount: 1,
      aggregate: 90,
      passed: 1,
      failed: 0,
      cases: [],
    },
    base: {
      status: "ok",
      ref: "origin/main",
      reportPath: "base-product.json",
      generatedAt: "2026-05-25T10:00:00.000Z",
      caseCount: 1,
      aggregate: 88,
      passed: 0,
      failed: 1,
      cases: [],
    },
    aggregateDelta: input.aggregateDelta,
    passDelta: input.passDelta,
    caseChanges:
      input.aggregateDelta < 0
        ? [
            {
              id: "case-1",
              family: "concept_explainer",
              prompt: "prompt",
              status: "regressed",
              scoreDelta: input.aggregateDelta,
            },
          ]
        : [
            {
              id: "case-1",
              family: "concept_explainer",
              prompt: "prompt",
              status: "improved",
              scoreDelta: input.aggregateDelta,
            },
          ],
  };
}

function competitiveReplay(input: {
  openCandleWinDelta: number;
  lossDelta: number;
  regressed: boolean;
}): CompetitiveReplayComparison {
  return {
    generatedAt: "2026-05-25T11:00:00.000Z",
    evalMode: "competitive",
    status: "compared",
    current: {
      status: "ok",
      ref: "HEAD",
      reportPath: "current-competitive.json",
      promptCount: 1,
      openCandleWins: 1,
      losses: 0,
      ties: 0,
      cases: [],
    },
    base: {
      status: "ok",
      ref: "origin/main",
      reportPath: "base-competitive.json",
      promptCount: 1,
      openCandleWins: 0,
      losses: 1,
      ties: 0,
      cases: [],
    },
    openCandleWinDelta: input.openCandleWinDelta,
    lossDelta: input.lossDelta,
    tieDelta: 0,
    caseChanges: [
      {
        id: "fixed-1",
        prompt: "prompt",
        status: input.regressed ? "regressed" : "improved",
        baseOpenCandleScore: 4,
        currentOpenCandleScore: input.regressed ? 3 : 5,
        scoreDelta: input.regressed ? -1 : 1,
        baseWinner: input.regressed ? "opencandle" : "claude",
        currentWinner: input.regressed ? "claude" : "opencandle",
        cachedCompetitors: ["claude"],
      },
    ],
  };
}

function promptPolicy(input: {
  failed: number;
  artifactContracts: string[];
  evidenceTypes?: string[];
  structuredFailures: string[];
  promptBudget?: { totalSectionBudget: number; ceiling: number };
}) {
  return {
    generatedAt: "2026-05-25T11:00:00.000Z",
    manifestPath: "manifest.json",
    selectedPromptIds: ["case-1"],
    summary: {
      total: 1,
      passed: input.failed === 0 ? 1 : 0,
      failed: input.failed,
    },
    promptBudget: input.promptBudget,
    cases: [
      {
        id: "case-1",
        passed: input.failed === 0,
        failures:
          input.failed === 0 ? [] : [{ field: "taskFamily", message: "taskFamily mismatch" }],
        observed: {
          taskFamily: "portfolio_review",
          policyCardId: "portfolio_rebalance_review",
          evidenceTypes: input.evidenceTypes ?? ["portfolio_exposure_map"],
          artifactContractIds: input.artifactContracts,
          structuredCheckFailures: input.structuredFailures,
        },
      },
    ],
  };
}
