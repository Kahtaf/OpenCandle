import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildCapabilityScorecard,
  buildMigrationComparisonReport,
  compareMigrationBaseline,
  evaluateMultiTurnPlanningAssertions,
  type PromptMigrationManifestEntry,
} from "../../evals/prompt-to-policy-baseline.js";

const entry = {
  id: "safe-cash-products",
  expected: {
    routeKind: "agent_task",
    workflow: "general_finance_qa",
    toolBundles: [],
    providerGapDisclosure: ["cash_yield_products"],
    finalAnswerHardAssertions: [
      "does not fabricate live yields",
      "labels current yield facts as needing verification",
    ],
  },
} satisfies PromptMigrationManifestEntry;

describe("prompt-to-policy baseline comparison", () => {
  it("passes when route, workflow, tools, gaps, and hard assertions match", () => {
    const result = compareMigrationBaseline(entry, {
      routeKind: "agent_task",
      workflow: "general_finance_qa",
      toolCalls: [],
      providerGapDisclosure: ["cash_yield_products"],
      finalAnswerHardAssertionsPassed: [
        "does not fabricate live yields",
        "labels current yield facts as needing verification",
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it("fails an unaccepted route, tool, gap, or final-answer assertion change", () => {
    const result = compareMigrationBaseline(entry, {
      routeKind: "workflow_dispatch",
      workflow: "portfolio_builder",
      toolCalls: ["get_stock_quote"],
      providerGapDisclosure: [],
      finalAnswerHardAssertionsPassed: ["does not fabricate live yields"],
    });

    expect(result.passed).toBe(false);
    expect(result.failures.map((failure) => failure.field)).toEqual([
      "routeKind",
      "workflow",
      "toolCalls",
      "providerGapDisclosure",
      "finalAnswerHardAssertions",
    ]);
  });

  it("allows an explicitly accepted improvement to differ from baseline", () => {
    const result = compareMigrationBaseline(entry, {
      routeKind: "agent_task",
      workflow: "general_finance_qa",
      toolCalls: ["search_web"],
      providerGapDisclosure: ["cash_yield_products"],
      finalAnswerHardAssertionsPassed: [
        "does not fabricate live yields",
        "labels current yield facts as needing verification",
      ],
      acceptedImprovements: [
        {
          field: "toolCalls",
          reason: "live cash-yield provider implemented under a later accepted gate",
        },
      ],
    });

    expect(result.passed).toBe(true);
    expect(result.acceptedImprovements).toHaveLength(1);
  });

  it("reports disclosed capability gaps as honest but not specialist-competitive", () => {
    const scorecard = buildCapabilityScorecard([
      {
        id: "etf-overlap-check",
        expected: {
          providerGapDisclosure: ["etf_holdings_overlap"],
        },
      },
      {
        id: "brokerage-choice-taxable",
        expected: {
          providerGapDisclosure: ["brokerage_comparison"],
        },
      },
    ]);

    expect(scorecard).toEqual([
      {
        capabilityGapId: "brokerage_comparison",
        promptIds: ["brokerage-choice-taxable"],
        status: "honest_disclosed_not_specialist_competitive",
      },
      {
        capabilityGapId: "etf_holdings_overlap",
        promptIds: ["etf-overlap-check"],
        status: "honest_disclosed_not_specialist_competitive",
      },
    ]);
  });

  it("marks an implemented capability gap as specialist competitive", () => {
    const scorecard = buildCapabilityScorecard(
      [
        {
          id: "etf-overlap-check",
          expected: {
            providerGapDisclosure: ["etf_holdings_overlap"],
          },
        },
      ],
      { implementedCapabilityGaps: ["etf_holdings_overlap"] },
    );

    expect(scorecard[0]?.status).toBe("specialist_competitive");
  });

  it("loads the committed migration manifest shape", () => {
    const manifest = JSON.parse(
      readFileSync("docs/internal/prompt-to-policy-migration-manifest.json", "utf-8"),
    ) as { prompts: PromptMigrationManifestEntry[] };
    const etfOverlap = manifest.prompts.find((prompt) => prompt.id === "etf-overlap-check");

    expect(manifest.prompts.length).toBeGreaterThanOrEqual(16);
    expect(buildCapabilityScorecard(manifest.prompts).length).toBeGreaterThan(0);
    expect(etfOverlap?.expected.providerGapDisclosure).toEqual([]);
    expect(etfOverlap?.expected.requiredEvidence).toContain("holdings_overlap_tool_when_available");
  });

  it("builds before/after migration comparison output with planning and parity status", () => {
    const report = buildMigrationComparisonReport({
      entries: [entry],
      observed: {
        "safe-cash-products": {
          routeKind: "agent_task",
          workflow: "general_finance_qa",
          toolCalls: [],
          providerGapDisclosure: ["cash_yield_products"],
          finalAnswerHardAssertionsPassed: [
            "does not fabricate live yields",
            "labels current yield facts as needing verification",
          ],
          planning: {
            taskFamily: "retail_finance_tradeoff",
            evidencePlanId: "placeholder_retail_finance_tradeoff",
            structuredCheckFailures: [],
            retryEligible: false,
          },
          parityStatus: "legacy_active",
          regressionClassification: "none",
        },
      },
    });

    expect(report.cases[0]).toEqual(
      expect.objectContaining({
        promptId: "safe-cash-products",
        passed: true,
        parityStatus: "legacy_active",
        regressionClassification: "none",
      }),
    );
    expect(report.cases[0]?.planning?.taskFamily).toBe("retail_finance_tradeoff");
  });

  it("reports multi-turn planning assertion failures by requirement", () => {
    const failures = evaluateMultiTurnPlanningAssertions({
      expected: {
        carryoverTaskFamily: "asset_compare",
        replacedEntity: "SCHD",
        staleEvidenceInvalidated: true,
        clarificationRequired: true,
      },
      observed: {
        taskFamily: "portfolio_build",
        entities: ["VYM"],
        staleEvidenceInvalidated: false,
        clarificationAsked: false,
      },
    });

    expect(failures.map((failure) => failure.requirement)).toEqual([
      "plan_carryover",
      "entity_replacement",
      "stale_evidence_invalidation",
      "ambiguous_followup_clarification",
    ]);
  });
});
