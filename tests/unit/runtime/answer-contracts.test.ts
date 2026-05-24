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
