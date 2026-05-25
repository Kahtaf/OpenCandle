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

  it("implements selected policy cards and leaves unrelated cards as placeholders", () => {
    expect(getPolicyCard("ticker_disambiguation").status).toBe("implemented");
    expect(getPolicyCard("sentiment_snapshot").status).toBe("implemented");
    expect(getPolicyCard("concept_explainer").status).toBe("implemented");
    expect(getPolicyCard("asset_compare").status).toBe("placeholder");
  });

  it("renders implemented policy only for dual-run or replacement-active planning", () => {
    expect(renderPolicyCardForPlanning(planning())).toContain("Ticker Disambiguation Policy");
    expect(renderPolicyCardForPlanning(planning({ behaviorMode: "replacement_active" }))).toContain("Ticker Disambiguation Policy");
    expect(renderPolicyCardForPlanning(planning({ behaviorMode: "observe_only" }))).toBe("");
  });

  it("keeps supplied-but-unverified event-risk prompts from blocking on clarification", () => {
    const rendered = renderPolicyCardForPlanning(planning({
      behaviorMode: "replacement_active",
    }));

    expect(rendered).toContain("explicitly say whether the supplied symbol is still the current primary ticker");
    expect(rendered).toContain("Do not call ask_user merely because a supplied ticker-like symbol is unverified");
    expect(rendered).toContain("If any clarification attempt returns no usable answer");
    expect(rendered).toContain("unresolved-ticker event-risk framework");
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

  it("renders current-event policy only after the slice leaves observe-only mode", () => {
    const currentEventPlanning = planning({
      taskFamily: "current_event_explanation",
      policyCardId: "current_event_explanation",
      evidencePlanId: "market_status",
      answerContractId: "current_event_explanation",
      structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
      capabilityGapIds: ["market_calendar"],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(currentEventPlanning);
    expect(rendered).toContain("Current Event Explanation Policy");
    expect(rendered).toContain("Fetch quote or market-status evidence before searching for news or event catalysts");
    expect(renderPolicyCardForPlanning({
      ...currentEventPlanning,
      behaviorMode: "observe_only",
    })).toBe("");
  });

  it("renders concept policy only after the slice leaves observe-only mode", () => {
    const conceptPlanning = planning({
      taskFamily: "concept_explainer",
      policyCardId: "concept_explainer",
      evidencePlanId: "placeholder_concept_explainer",
      answerContractId: "concept_explainer",
      structuredCheckIds: ["commitment_mode_respected"],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(conceptPlanning);
    expect(rendered).toContain("Concept Explainer Policy");
    expect(rendered).toContain("Bottom line");
    expect(rendered).toContain("Core mental model");
    expect(rendered).toContain("Practical workflow");
    expect(rendered).toContain("Where it misleads");
    expect(rendered).toContain("Cross-checks");
    expect(rendered).toContain("Quick checklist");
    expect(renderPolicyCardForPlanning({
      ...conceptPlanning,
      behaviorMode: "observe_only",
    })).toBe("");
  });

  it("renders sentiment policy only after the slice leaves observe-only mode", () => {
    const sentimentPlanning = planning({
      taskFamily: "sentiment_snapshot",
      policyCardId: "sentiment_snapshot",
      evidencePlanId: "placeholder_sentiment_snapshot",
      answerContractId: "sentiment_snapshot",
      structuredCheckIds: ["required_evidence_present", "source_coverage_disclosed", "data_gap_disclosed"],
      capabilityGapIds: ["sentiment_sample_depth"],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(sentimentPlanning);
    expect(rendered).toContain("Sentiment Snapshot Policy");
    expect(rendered).toContain("direction and strength");
    expect(rendered).toContain("score scale");
    expect(rendered).toContain("missing sources");
    expect(rendered).toContain("source-coverage risk");
    expect(rendered).toContain("low sample counts");
    expect(rendered).toContain("diverges from price action");
    expect(renderPolicyCardForPlanning({
      ...sentimentPlanning,
      behaviorMode: "observe_only",
    })).toBe("");
  });

  it("asserts policy cards disclose capability gaps instead of claiming them", () => {
    expect(validatePolicyCardRegistry()).toEqual([]);
  });
});
