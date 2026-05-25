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
      "single_asset_decision",
      "current_event_explanation",
      "sentiment_snapshot",
      "filing_thesis_review",
      "asset_compare",
      "macro_allocation_review",
      "options_strategy",
      "retail_finance_tradeoff",
      "concept_explainer",
    ]);
  });

  it("implements selected policy cards and leaves unrelated cards as placeholders", () => {
    expect(getPolicyCard("ticker_disambiguation").status).toBe("implemented");
    expect(getPolicyCard("single_asset_decision").status).toBe("implemented");
    expect(getPolicyCard("sentiment_snapshot").status).toBe("implemented");
    expect(getPolicyCard("filing_thesis_review").status).toBe("implemented");
    expect(getPolicyCard("retail_finance_tradeoff").status).toBe("implemented");
    expect(getPolicyCard("concept_explainer").status).toBe("implemented");
    expect(getPolicyCard("asset_compare").status).toBe("implemented");
    expect(getPolicyCard("macro_allocation_review").status).toBe("implemented");
    expect(getPolicyCard("options_strategy").status).toBe("implemented");
  });

  it("renders implemented policy only for dual-run or replacement-active planning", () => {
    expect(renderPolicyCardForPlanning(planning())).toContain("Ticker Disambiguation Policy");
    expect(renderPolicyCardForPlanning(planning({ behaviorMode: "replacement_active" }))).toContain("Ticker Disambiguation Policy");
    expect(renderPolicyCardForPlanning(planning({ behaviorMode: "observe_only" }))).toBe("");
  });

  it("renders single-asset policy only after the slice leaves observe-only mode", () => {
    const singleAssetPlanning = planning({
      taskFamily: "single_asset_decision",
      commitmentMode: "decision",
      policyCardId: "single_asset_decision",
      evidencePlanId: "placeholder_single_asset_decision",
      answerContractId: "single_asset_decision",
      structuredCheckIds: ["required_evidence_present", "freshness_disclosed", "data_gap_disclosed"],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(singleAssetPlanning);
    expect(rendered).toContain("Single Asset Decision Policy");
    expect(rendered).toContain("quote or tool-output date");
    expect(rendered).toContain("market-closed");
    expect(rendered).toContain("unavailable DCF");
    expect(rendered).toContain("clear call");
    expect(renderPolicyCardForPlanning({
      ...singleAssetPlanning,
      behaviorMode: "observe_only",
    })).toBe("");
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

  it("renders asset-compare policy only after the slice leaves observe-only mode", () => {
    const assetPlanning = planning({
      taskFamily: "asset_compare",
      policyCardId: "asset_compare",
      evidencePlanId: "placeholder_asset_compare",
      answerContractId: "asset_compare_tradeoff",
      structuredCheckIds: ["required_evidence_present", "data_gap_disclosed", "capability_gap_disclosure"],
      capabilityGapIds: ["etf_holdings_overlap"],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(assetPlanning);
    expect(rendered).toContain("Asset Compare Policy");
    expect(rendered).toContain("Compare the requested assets before portfolio construction");
    expect(rendered).toContain("exact holdings overlap by weight");
    expect(rendered).toContain("dividend");
    expect(rendered).toContain("growth");
    expect(rendered).toContain("tax");
    expect(renderPolicyCardForPlanning({
      ...assetPlanning,
      behaviorMode: "observe_only",
    })).toBe("");
  });

  it("renders macro allocation policy only after the slice leaves observe-only mode", () => {
    const macroPlanning = planning({
      taskFamily: "macro_allocation_review",
      commitmentMode: "decision",
      policyCardId: "macro_allocation_review",
      evidencePlanId: "market_status",
      answerContractId: "macro_allocation_review",
      structuredCheckIds: ["required_evidence_present", "freshness_disclosed", "data_gap_disclosed"],
      capabilityGapIds: ["market_calendar", "forward_rate_probabilities"],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(macroPlanning);
    expect(rendered).toContain("Macro Allocation Review Policy");
    expect(rendered).toContain("Current macro evidence");
    expect(rendered).toContain("provider gaps");
    expect(rendered).toContain("Sleeve-by-sleeve implications");
    expect(rendered).toContain("Watchlist and invalidation");
    expect(renderPolicyCardForPlanning({
      ...macroPlanning,
      behaviorMode: "observe_only",
    })).toBe("");
  });

  it("renders options policy only after the slice leaves observe-only mode", () => {
    const optionsPlanning = planning({
      taskFamily: "options_strategy",
      commitmentMode: "decision",
      policyCardId: "options_strategy",
      evidencePlanId: "placeholder_options_strategy",
      answerContractId: "options_strategy",
      structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(optionsPlanning);
    expect(rendered).toContain("Options Strategy Policy");
    expect(rendered).toContain("owned underlying");
    expect(rendered).toContain("catalyst");
    expect(rendered).toContain("premium received");
    expect(rendered).toContain("protective put");
    expect(renderPolicyCardForPlanning({
      ...optionsPlanning,
      behaviorMode: "observe_only",
    })).toBe("");
  });

  it("does not inject unrelated placeholder policy cards", () => {
    const rendered = renderPolicyCardForPlanning(planning({
      taskFamily: "portfolio_build",
      policyCardId: "portfolio_build",
      evidencePlanId: "placeholder_portfolio_build",
      answerContractId: "portfolio_build",
      capabilityGapIds: [],
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

  it("renders filing policy only after the slice leaves observe-only mode", () => {
    const filingPlanning = planning({
      taskFamily: "filing_thesis_review",
      policyCardId: "filing_thesis_review",
      evidencePlanId: "placeholder_filing_thesis_review",
      answerContractId: "filing_thesis_review",
      structuredCheckIds: ["required_evidence_present", "data_gap_disclosed"],
      capabilityGapIds: [],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(filingPlanning);
    expect(rendered).toContain("Filing Thesis Review Policy");
    expect(rendered).toContain("get_sec_filings");
    expect(rendered).toContain("filing metadata");
    expect(rendered).toContain("filing-section summaries");
    expect(rendered).toContain("market data");
    expect(rendered).toContain("Do not claim");
    expect(renderPolicyCardForPlanning({
      ...filingPlanning,
      behaviorMode: "observe_only",
    })).toBe("");
  });

  it("renders retail policy only after the slice leaves observe-only mode", () => {
    const retailPlanning = planning({
      taskFamily: "retail_finance_tradeoff",
      policyCardId: "retail_finance_tradeoff",
      evidencePlanId: "placeholder_retail_finance_tradeoff",
      answerContractId: "retail_tradeoff_framework",
      structuredCheckIds: ["data_gap_disclosed", "capability_gap_disclosure"],
      capabilityGapIds: ["brokerage_comparison", "cash_yield_products", "fund_tax_efficiency"],
      behaviorMode: "dual_run",
    });

    const rendered = renderPolicyCardForPlanning(retailPlanning);
    expect(rendered).toContain("Retail Finance Tradeoff Policy");
    expect(rendered).toContain("Do not punt");
    expect(rendered).toContain("brokerage");
    expect(rendered).toContain("cash sweep yields");
    expect(rendered).toContain("current yield facts");
    expect(rendered).toContain("6.8% mortgage");
    expect(renderPolicyCardForPlanning({
      ...retailPlanning,
      behaviorMode: "observe_only",
    })).toBe("");
  });

  it("asserts policy cards disclose capability gaps instead of claiming them", () => {
    expect(validatePolicyCardRegistry()).toEqual([]);
  });
});
