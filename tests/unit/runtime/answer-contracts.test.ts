import { describe, expect, it } from "vitest";
import {
  ANSWER_CONTRACT_REGISTRY,
  COMMITMENT_MODE_CONTRACTS,
  evaluateFrameworkFallbackEligibility,
  runStructuredChecks,
} from "../../../src/runtime/answer-contracts.js";
import type { PlanningEvidenceRecord } from "../../../src/runtime/planning-evidence.js";

const tickerEvidence: PlanningEvidenceRecord = {
  id: "ticker_disambiguation:selected_slice",
  evidenceType: "ticker_disambiguation",
  source: { toolName: "planning_ticker_disambiguation" },
  entityScope: { query: "Does XYZQ have earnings tonight?" },
  observedAt: "1970-01-01T00:00:00.000Z",
  providerStatus: "available",
  normalizedFacts: {
    selectedMigrationSlice: "ticker_disambiguation",
    requiresSymbolVerification: true,
  },
  gaps: [{
    kind: "capability_gap",
    capabilityGapId: "earnings_event_risk",
    reason: "No richer earnings-event data in V1.",
  }],
  caveats: ["No symbol was verified by this evidence plan."],
};

describe("answer contracts", () => {
  it("defines the selected ticker-disambiguation contract with required obligations", () => {
    const contract = ANSWER_CONTRACT_REGISTRY.ticker_disambiguation;

    expect(contract.implemented).toBe(true);
    expect(contract.requiredEvidenceTypes).toEqual(["ticker_disambiguation"]);
    expect(contract.requiredFinalFields).toEqual(expect.arrayContaining([
      "symbol_verification_disclosure",
      "framework_or_checklist",
      "data_gap_disclosure",
      "risk_downside",
    ]));
    expect(contract.requiresConcreteCommitment).toBe(false);
    expect(contract.frameworkFallback).toBe("diagnostic_until_parity");
  });

  it("defines single-asset decision obligations for clear calls with freshness and risks", () => {
    const contract = ANSWER_CONTRACT_REGISTRY.single_asset_decision;

    expect(contract.implemented).toBe(true);
    expect(contract.commitmentMode).toBe("decision");
    expect(contract.requiredEvidenceTypes).toEqual([]);
    expect(contract.requiredFinalFields).toEqual([
      "clear_commitment",
      "risk_downside",
      "freshness_disclosure",
      "data_gap_disclosure",
    ]);
    expect(contract.requiresFreshness).toBe(true);
    expect(contract.requiresDataGapDisclosure).toBe(true);
    expect(contract.requiresRiskDownside).toBe(true);
    expect(contract.requiresConcreteCommitment).toBe(true);
    expect(contract.frameworkFallback).toBe("not_allowed");
  });

  it("defines commitment-mode contracts for every V1 mode", () => {
    expect(Object.keys(COMMITMENT_MODE_CONTRACTS).sort()).toEqual([
      "clarify",
      "compare_tradeoffs",
      "construct",
      "decision",
      "framework",
      "update_state",
    ]);
    expect(COMMITMENT_MODE_CONTRACTS.decision.requiresConcreteCommitment).toBe(true);
    expect(COMMITMENT_MODE_CONTRACTS.framework.requiresConcreteCommitment).toBe(false);
  });

  it("defines current-event obligations for freshness, source coverage, and market-calendar gaps", () => {
    const contract = ANSWER_CONTRACT_REGISTRY.current_event_explanation;

    expect(contract.implemented).toBe(true);
    expect(contract.requiredEvidenceTypes).toEqual(["market_status"]);
    expect(contract.requiredFinalFields).toEqual(expect.arrayContaining([
      "framework_or_checklist",
      "freshness_disclosure",
      "source_coverage",
      "data_gap_disclosure",
    ]));
    expect(contract.requiresFreshness).toBe(true);
    expect(contract.requiresSourceCoverage).toBe(true);
    expect(contract.requiresDataGapDisclosure).toBe(true);
    expect(contract.capabilityGapIds).toContain("market_calendar");
  });

  it("defines concept-explainer obligations without live evidence or commitment requirements", () => {
    const contract = ANSWER_CONTRACT_REGISTRY.concept_explainer;

    expect(contract.implemented).toBe(true);
    expect(contract.requiredEvidenceTypes).toEqual([]);
    expect(contract.requiredFinalFields).toEqual(["framework_or_checklist"]);
    expect(contract.requiresFreshness).toBe(false);
    expect(contract.requiresDataGapDisclosure).toBe(false);
    expect(contract.requiresSourceCoverage).toBe(false);
    expect(contract.requiresConcreteCommitment).toBe(false);
    expect(contract.frameworkFallback).toBe("not_allowed");
  });

  it("defines sentiment-snapshot obligations for source coverage without trade commitment", () => {
    const contract = ANSWER_CONTRACT_REGISTRY.sentiment_snapshot;

    expect(contract.implemented).toBe(true);
    expect(contract.requiredEvidenceTypes).toEqual([]);
    expect(contract.requiredFinalFields).toEqual(["source_coverage", "data_gap_disclosure"]);
    expect(contract.requiresFreshness).toBe(false);
    expect(contract.requiresDataGapDisclosure).toBe(true);
    expect(contract.requiresSourceCoverage).toBe(true);
    expect(contract.requiresConcreteCommitment).toBe(false);
    expect(contract.capabilityGapIds).toEqual(["sentiment_sample_depth"]);
    expect(contract.frameworkFallback).toBe("not_allowed");
  });

  it("defines filing-thesis obligations for source separation without trade commitment", () => {
    const contract = ANSWER_CONTRACT_REGISTRY.filing_thesis_review;

    expect(contract.implemented).toBe(true);
    expect(contract.requiredEvidenceTypes).toEqual([]);
    expect(contract.requiredFinalFields).toEqual(["source_coverage", "data_gap_disclosure", "framework_or_checklist"]);
    expect(contract.requiresFreshness).toBe(false);
    expect(contract.requiresDataGapDisclosure).toBe(true);
    expect(contract.requiresSourceCoverage).toBe(true);
    expect(contract.requiresConcreteCommitment).toBe(false);
    expect(contract.capabilityGapIds).toEqual([]);
    expect(contract.frameworkFallback).toBe("not_allowed");
  });

  it("defines retail tradeoff obligations for comparisons without trade commitment", () => {
    const contract = ANSWER_CONTRACT_REGISTRY.retail_tradeoff_framework;

    expect(contract.implemented).toBe(true);
    expect(contract.requiredEvidenceTypes).toEqual([]);
    expect(contract.requiredFinalFields).toEqual([
      "comparison_tradeoffs",
      "data_gap_disclosure",
      "framework_or_checklist",
    ]);
    expect(contract.requiresDataGapDisclosure).toBe(true);
    expect(contract.requiresConcreteCommitment).toBe(false);
    expect(contract.capabilityGapIds).toEqual([
      "brokerage_comparison",
      "cash_yield_products",
      "fund_tax_efficiency",
    ]);
    expect(contract.frameworkFallback).toBe("not_allowed");
  });

  it("defines asset-compare obligations for tradeoffs without construction commitment", () => {
    const contract = ANSWER_CONTRACT_REGISTRY.asset_compare_tradeoff;

    expect(contract.implemented).toBe(true);
    expect(contract.commitmentMode).toBe("compare_tradeoffs");
    expect(contract.requiredEvidenceTypes).toEqual([]);
    expect(contract.requiredFinalFields).toEqual([
      "comparison_tradeoffs",
      "risk_downside",
      "data_gap_disclosure",
      "source_coverage",
    ]);
    expect(contract.requiresDataGapDisclosure).toBe(true);
    expect(contract.requiresSourceCoverage).toBe(true);
    expect(contract.requiresConcreteCommitment).toBe(false);
    expect(contract.capabilityGapIds).toEqual(["etf_holdings_overlap"]);
    expect(contract.frameworkFallback).toBe("not_allowed");
  });
});

describe("structured checks", () => {
  it("records observe-only failures without activating retry", () => {
    const trace = runStructuredChecks({
      contract: ANSWER_CONTRACT_REGISTRY.ticker_disambiguation,
      evidenceRecords: [],
      finalAnswerMetadata: {
        commitmentMode: "framework",
        finalFields: ["framework_or_checklist"],
      },
    });

    expect(trace.mode).toBe("observe_only");
    expect(trace.activeRetryAllowed).toBe(false);
    expect(trace.retryEligibility.eligible).toBe(true);
    expect(trace.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkId: "required_evidence_present" }),
      expect.objectContaining({ checkId: "data_gap_disclosed" }),
      expect.objectContaining({ checkId: "capability_gap_disclosure" }),
    ]));
  });

  it("passes selected-slice checks when structured metadata satisfies the contract", () => {
    const trace = runStructuredChecks({
      contract: ANSWER_CONTRACT_REGISTRY.ticker_disambiguation,
      evidenceRecords: [tickerEvidence],
      finalAnswerMetadata: {
        commitmentMode: "framework",
        finalFields: [
          "symbol_verification_disclosure",
          "framework_or_checklist",
          "data_gap_disclosure",
          "risk_downside",
        ],
        disclosedCapabilityGapIds: ["earnings_event_risk"],
      },
    });

    expect(trace.failures).toEqual([]);
    expect(trace.results.every((result) => result.observedOnly)).toBe(true);
    expect(trace.retryEligibility.eligible).toBe(false);
  });

  it("checks freshness and source coverage from metadata rather than prose headings", () => {
    const trace = runStructuredChecks({
      contract: ANSWER_CONTRACT_REGISTRY.current_event_explanation,
      evidenceRecords: [{
        ...tickerEvidence,
        id: "market_status:deterministic",
        evidenceType: "market_status",
        normalizedFacts: { marketStatus: "closed_weekend" },
      }],
      finalAnswerMetadata: {
        commitmentMode: "framework",
        finalFields: ["freshness_disclosure", "data_gap_disclosure"],
        disclosedCapabilityGapIds: ["market_calendar"],
      },
    });

    expect(trace.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ checkId: "freshness_disclosed" }),
      expect.objectContaining({ checkId: "source_coverage_disclosed" }),
    ]));
  });

  it("passes current-event checks when freshness, sources, and market-calendar gaps are disclosed", () => {
    const trace = runStructuredChecks({
      contract: ANSWER_CONTRACT_REGISTRY.current_event_explanation,
      evidenceRecords: [{
        ...tickerEvidence,
        id: "market_status:deterministic",
        evidenceType: "market_status",
        normalizedFacts: {
          marketStatus: "after_close",
          lastTradingDay: "2026-05-22",
        },
        gaps: [{
          kind: "capability_gap",
          capabilityGapId: "market_calendar",
          reason: "V1 deterministic market calendar.",
        }],
      }],
      finalAnswerMetadata: {
        commitmentMode: "framework",
        finalFields: ["framework_or_checklist", "freshness_disclosure", "source_coverage", "data_gap_disclosure"],
        freshness: {
          asOfDate: "2026-05-22",
          marketStatus: "after_close",
          lastTradingDay: "2026-05-22",
        },
        sourceCoverage: {
          sources: ["market_status", "quote", "web_news"],
        },
        disclosedCapabilityGapIds: ["market_calendar"],
      },
    });

    expect(trace.failures).toEqual([]);
    expect(trace.retryEligibility.eligible).toBe(false);
  });

  it("keeps framework fallback diagnostic until parity allows activation", () => {
    const fallback = evaluateFrameworkFallbackEligibility({
      contract: ANSWER_CONTRACT_REGISTRY.ticker_disambiguation,
      evidenceRecords: [tickerEvidence],
      parityStatus: "legacy_active",
    });

    expect(fallback.eligible).toBe(true);
    expect(fallback.active).toBe(false);
    expect(fallback.mode).toBe("diagnostic_only");
  });
});
