import { describe, expect, it } from "vitest";
import {
  POLICY_CARD_IDS,
  getPolicyCard,
  renderPolicyCardForPlanning,
  validatePolicyCardRegistry,
} from "../../../src/prompts/policy-cards.js";
import type { PlanningEnvelope } from "../../../src/routing/planning.js";

function planning(overrides: Partial<PlanningEnvelope> = {}): PlanningEnvelope {
  return {
    version: "planning-v1",
    taskFamily: "ticker_disambiguation",
    commitmentMode: "framework",
    policyCardId: "ticker_disambiguation",
    evidencePlanId: "ticker_disambiguation",
    answerContractId: "ticker_disambiguation",
    structuredCheckIds: ["required_evidence_present"],
    capabilityGapIds: ["earnings_event_risk"],
    behaviorMode: "dual_run",
    workspacePlaceholderIds: [],
    artifactPlaceholderIds: [],
    diagnostics: [],
    ...overrides,
  };
}

describe("policy cards", () => {
  it("declares stable IDs for V1 policy-card candidates", () => {
    expect(POLICY_CARD_IDS).toEqual([
      "ticker_disambiguation",
      "current_event_explanation",
      "sentiment_snapshot",
      "filing_thesis_review",
      "asset_compare",
      "retail_finance_tradeoff",
      "concept_explainer",
    ]);
  });

  it("implements ticker disambiguation and leaves other cards as placeholders", () => {
    expect(getPolicyCard("ticker_disambiguation").status).toBe("implemented");
    expect(getPolicyCard("asset_compare").status).toBe("placeholder");
  });

  it("renders implemented policy only for dual-run or replacement-active planning", () => {
    expect(renderPolicyCardForPlanning(planning())).toContain("Ticker Disambiguation Policy");
    expect(renderPolicyCardForPlanning(planning({ behaviorMode: "replacement_active" }))).toContain("Ticker Disambiguation Policy");
    expect(renderPolicyCardForPlanning(planning({ behaviorMode: "observe_only" }))).toBe("");
  });

  it("does not inject unrelated placeholder policy cards", () => {
    const rendered = renderPolicyCardForPlanning(planning({
      taskFamily: "asset_compare",
      policyCardId: "asset_compare",
      evidencePlanId: "placeholder_asset_compare",
      answerContractId: "asset_compare_tradeoff",
      capabilityGapIds: ["etf_holdings_overlap"],
    }));

    expect(rendered).toBe("");
  });

  it("asserts policy cards disclose capability gaps instead of claiming them", () => {
    expect(validatePolicyCardRegistry()).toEqual([]);
  });
});
