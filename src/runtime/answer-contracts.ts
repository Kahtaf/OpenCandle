import type {
  AnswerContractId,
  CapabilityGapId,
  CommitmentMode,
  StructuredCheckId,
  TaskFamily,
} from "../routing/planning.js";
import type { PlanningEvidenceRecord, PlanningEvidenceType } from "./planning-evidence.js";

export type FinalAnswerField =
  | "clear_commitment"
  | "comparison_tradeoffs"
  | "constructed_output"
  | "state_update_confirmation"
  | "clarifying_question"
  | "symbol_verification_disclosure"
  | "framework_or_checklist"
  | "freshness_disclosure"
  | "data_gap_disclosure"
  | "risk_downside"
  | "source_coverage"
  | "sentiment_rationale"
  | "confidence_or_caveats";

export type FrameworkFallbackMode =
  | "not_allowed"
  | "diagnostic_until_parity"
  | "active_after_parity";

export type ParityMigrationStatus =
  | "legacy_active"
  | "observe_only"
  | "dual_run"
  | "replacement_active"
  | "legacy_removed";

export interface CommitmentModeContract {
  mode: CommitmentMode;
  requiredFinalFields: FinalAnswerField[];
  requiresConcreteCommitment: boolean;
  description: string;
}

export interface AnswerContractDefinition {
  id: AnswerContractId;
  taskFamily: TaskFamily;
  commitmentMode: CommitmentMode;
  implemented: boolean;
  requiredEvidenceTypes: PlanningEvidenceType[];
  requiredFinalFields: FinalAnswerField[];
  requiresFreshness: boolean;
  requiresDataGapDisclosure: boolean;
  requiresRiskDownside: boolean;
  requiresSourceCoverage: boolean;
  requiresConcreteCommitment: boolean;
  capabilityGapIds: CapabilityGapId[];
  frameworkFallback: FrameworkFallbackMode;
}

export interface FinalAnswerMetadata {
  commitmentMode: CommitmentMode;
  finalFields: FinalAnswerField[];
  freshness?: {
    asOfDate?: string;
    marketStatus?: string;
    lastTradingDay?: string;
  };
  sourceCoverage?: {
    sources: string[];
    sampleSize?: number;
  };
  disclosedProviderStatuses?: string[];
  disclosedCapabilityGapIds?: CapabilityGapId[];
}

export interface StructuredCheckResult {
  checkId: StructuredCheckId;
  passed: boolean;
  observedOnly: true;
  failureReason?: string;
}

export interface RetryEligibilityTrace {
  eligible: boolean;
  activeRetryAllowed: false;
  reasons: string[];
}

export interface StructuredCheckTrace {
  mode: "observe_only";
  answerContractId: AnswerContractId;
  results: StructuredCheckResult[];
  failures: StructuredCheckResult[];
  retryEligibility: RetryEligibilityTrace;
  activeRetryAllowed: false;
}

export interface FrameworkFallbackEligibility {
  eligible: boolean;
  active: boolean;
  mode: "not_applicable" | "diagnostic_only" | "active";
  reason: string;
}

export interface StructuredCheckInput {
  contract: AnswerContractDefinition;
  evidenceRecords: PlanningEvidenceRecord[];
  finalAnswerMetadata: FinalAnswerMetadata;
  structuredCheckIds?: StructuredCheckId[];
  answerText?: string;
}

export interface FrameworkFallbackInput {
  contract: AnswerContractDefinition;
  evidenceRecords: PlanningEvidenceRecord[];
  parityStatus: ParityMigrationStatus;
}

export const COMMITMENT_MODE_CONTRACTS: Record<CommitmentMode, CommitmentModeContract> = {
  decision: {
    mode: "decision",
    requiredFinalFields: ["clear_commitment", "risk_downside"],
    requiresConcreteCommitment: true,
    description: "Make a clear call with major risks and conditions.",
  },
  compare_tradeoffs: {
    mode: "compare_tradeoffs",
    requiredFinalFields: ["comparison_tradeoffs", "risk_downside"],
    requiresConcreteCommitment: false,
    description: "Compare options without converting the task into construction unless requested.",
  },
  framework: {
    mode: "framework",
    requiredFinalFields: ["framework_or_checklist"],
    requiresConcreteCommitment: false,
    description: "Give a useful framework or checklist without inventing current facts.",
  },
  construct: {
    mode: "construct",
    requiredFinalFields: ["constructed_output", "risk_downside"],
    requiresConcreteCommitment: true,
    description: "Construct the requested allocation, screen, or plan.",
  },
  update_state: {
    mode: "update_state",
    requiredFinalFields: ["state_update_confirmation"],
    requiresConcreteCommitment: false,
    description: "Confirm the state change and preserve relevant context.",
  },
  clarify: {
    mode: "clarify",
    requiredFinalFields: ["clarifying_question"],
    requiresConcreteCommitment: false,
    description: "Ask only for the missing information required to proceed.",
  },
};

export const ANSWER_CONTRACT_REGISTRY: Record<AnswerContractId, AnswerContractDefinition> = {
  single_asset_decision: {
    id: "single_asset_decision",
    taskFamily: "single_asset_decision",
    commitmentMode: "decision",
    implemented: true,
    requiredEvidenceTypes: [],
    requiredFinalFields: [
      "clear_commitment",
      "risk_downside",
      "freshness_disclosure",
      "data_gap_disclosure",
    ],
    requiresFreshness: true,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: true,
    requiresSourceCoverage: false,
    requiresConcreteCommitment: true,
    capabilityGapIds: [],
    frameworkFallback: "not_allowed",
  },
  asset_compare_tradeoff: {
    id: "asset_compare_tradeoff",
    taskFamily: "asset_compare",
    commitmentMode: "compare_tradeoffs",
    implemented: true,
    requiredEvidenceTypes: [],
    requiredFinalFields: [
      "comparison_tradeoffs",
      "risk_downside",
      "data_gap_disclosure",
      "source_coverage",
    ],
    requiresFreshness: false,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: true,
    requiresSourceCoverage: true,
    requiresConcreteCommitment: false,
    capabilityGapIds: ["etf_holdings_overlap"],
    frameworkFallback: "not_allowed",
  },
  portfolio_build: placeholderContract("portfolio_build", "portfolio_build", "construct", [
    "constructed_output",
  ]),
  portfolio_review: {
    id: "portfolio_review",
    taskFamily: "portfolio_review",
    commitmentMode: "decision",
    implemented: true,
    requiredEvidenceTypes: [],
    requiredFinalFields: [
      "clear_commitment",
      "risk_downside",
      "framework_or_checklist",
      "data_gap_disclosure",
      "source_coverage",
    ],
    requiresFreshness: false,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: true,
    requiresSourceCoverage: true,
    requiresConcreteCommitment: true,
    capabilityGapIds: [],
    frameworkFallback: "not_allowed",
  },
  macro_allocation_review: {
    id: "macro_allocation_review",
    taskFamily: "macro_allocation_review",
    commitmentMode: "decision",
    implemented: true,
    requiredEvidenceTypes: ["market_status"],
    requiredFinalFields: [
      "clear_commitment",
      "risk_downside",
      "framework_or_checklist",
      "freshness_disclosure",
      "data_gap_disclosure",
      "source_coverage",
    ],
    requiresFreshness: true,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: true,
    requiresSourceCoverage: true,
    requiresConcreteCommitment: true,
    capabilityGapIds: ["market_calendar", "forward_rate_probabilities"],
    frameworkFallback: "not_allowed",
  },
  options_strategy: {
    id: "options_strategy",
    taskFamily: "options_strategy",
    commitmentMode: "decision",
    implemented: true,
    requiredEvidenceTypes: [],
    requiredFinalFields: [
      "clear_commitment",
      "risk_downside",
      "freshness_disclosure",
      "data_gap_disclosure",
      "source_coverage",
    ],
    requiresFreshness: true,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: true,
    requiresSourceCoverage: true,
    requiresConcreteCommitment: true,
    capabilityGapIds: [],
    frameworkFallback: "not_allowed",
  },
  backtest_review: {
    id: "backtest_review",
    taskFamily: "backtest_review",
    commitmentMode: "framework",
    implemented: true,
    requiredEvidenceTypes: [],
    requiredFinalFields: [
      "framework_or_checklist",
      "risk_downside",
      "data_gap_disclosure",
      "source_coverage",
    ],
    requiresFreshness: false,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: true,
    requiresSourceCoverage: true,
    requiresConcreteCommitment: false,
    capabilityGapIds: [],
    frameworkFallback: "not_allowed",
  },
  stateful_tracking_update: {
    id: "stateful_tracking_update",
    taskFamily: "stateful_tracking_update",
    commitmentMode: "update_state",
    implemented: true,
    requiredEvidenceTypes: [],
    requiredFinalFields: ["state_update_confirmation", "data_gap_disclosure"],
    requiresFreshness: false,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: false,
    requiresSourceCoverage: false,
    requiresConcreteCommitment: false,
    capabilityGapIds: [],
    frameworkFallback: "not_allowed",
  },
  current_event_explanation: {
    id: "current_event_explanation",
    taskFamily: "current_event_explanation",
    commitmentMode: "framework",
    implemented: true,
    requiredEvidenceTypes: ["market_status"],
    requiredFinalFields: [
      "framework_or_checklist",
      "freshness_disclosure",
      "source_coverage",
      "data_gap_disclosure",
    ],
    requiresFreshness: true,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: false,
    requiresSourceCoverage: true,
    requiresConcreteCommitment: false,
    capabilityGapIds: ["market_calendar"],
    frameworkFallback: "not_allowed",
  },
  ticker_disambiguation: {
    id: "ticker_disambiguation",
    taskFamily: "ticker_disambiguation",
    commitmentMode: "framework",
    implemented: true,
    requiredEvidenceTypes: ["ticker_disambiguation"],
    requiredFinalFields: [
      "symbol_verification_disclosure",
      "framework_or_checklist",
      "data_gap_disclosure",
      "risk_downside",
    ],
    requiresFreshness: false,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: true,
    requiresSourceCoverage: false,
    requiresConcreteCommitment: false,
    capabilityGapIds: ["earnings_event_risk"],
    frameworkFallback: "diagnostic_until_parity",
  },
  sentiment_snapshot: {
    id: "sentiment_snapshot",
    taskFamily: "sentiment_snapshot",
    commitmentMode: "framework",
    implemented: true,
    requiredEvidenceTypes: [],
    requiredFinalFields: [
      "source_coverage",
      "sentiment_rationale",
      "confidence_or_caveats",
      "data_gap_disclosure",
    ],
    requiresFreshness: false,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: false,
    requiresSourceCoverage: true,
    requiresConcreteCommitment: false,
    capabilityGapIds: ["sentiment_sample_depth"],
    frameworkFallback: "not_allowed",
  },
  filing_thesis_review: {
    id: "filing_thesis_review",
    taskFamily: "filing_thesis_review",
    commitmentMode: "framework",
    implemented: true,
    requiredEvidenceTypes: [],
    requiredFinalFields: ["source_coverage", "data_gap_disclosure", "framework_or_checklist"],
    requiresFreshness: false,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: false,
    requiresSourceCoverage: true,
    requiresConcreteCommitment: false,
    capabilityGapIds: [],
    frameworkFallback: "not_allowed",
  },
  retail_tradeoff_framework: {
    id: "retail_tradeoff_framework",
    taskFamily: "retail_finance_tradeoff",
    commitmentMode: "framework",
    implemented: true,
    requiredEvidenceTypes: [],
    requiredFinalFields: ["comparison_tradeoffs", "data_gap_disclosure", "framework_or_checklist"],
    requiresFreshness: false,
    requiresDataGapDisclosure: true,
    requiresRiskDownside: false,
    requiresSourceCoverage: false,
    requiresConcreteCommitment: false,
    capabilityGapIds: ["brokerage_comparison", "cash_yield_products", "fund_tax_efficiency"],
    frameworkFallback: "not_allowed",
  },
  concept_explainer: {
    id: "concept_explainer",
    taskFamily: "concept_explainer",
    commitmentMode: "framework",
    implemented: true,
    requiredEvidenceTypes: [],
    requiredFinalFields: ["framework_or_checklist"],
    requiresFreshness: false,
    requiresDataGapDisclosure: false,
    requiresRiskDownside: false,
    requiresSourceCoverage: false,
    requiresConcreteCommitment: false,
    capabilityGapIds: [],
    frameworkFallback: "not_allowed",
  },
  general_fallback: placeholderContract("general_fallback", "general_fallback", "framework", [
    "data_gap_disclosure",
  ]),
};

export function runStructuredChecks(input: StructuredCheckInput): StructuredCheckTrace {
  const requestedChecks = new Set(input.structuredCheckIds ?? []);
  const results: StructuredCheckResult[] = [
    checkRequiredEvidence(input.contract, input.evidenceRecords),
    checkFreshness(input.contract, input.finalAnswerMetadata),
    checkDataGapDisclosure(input.contract, input.evidenceRecords, input.finalAnswerMetadata),
    checkCommitmentMode(input.contract, input.finalAnswerMetadata),
    checkRequiredFinalFields(input.contract, input.finalAnswerMetadata),
    checkSourceCoverage(input.contract, input.finalAnswerMetadata),
    checkCapabilityGapDisclosure(input.contract, input.evidenceRecords, input.finalAnswerMetadata),
    ...semanticChecks(requestedChecks, input.answerText),
  ];
  const failures = results.filter((result) => !result.passed);
  const retryReasons = failures.map(
    (failure) => `${failure.checkId}: ${failure.failureReason ?? "failed"}`,
  );

  return {
    mode: "observe_only",
    answerContractId: input.contract.id,
    results,
    failures,
    retryEligibility: {
      eligible: failures.length > 0,
      activeRetryAllowed: false,
      reasons: retryReasons,
    },
    activeRetryAllowed: false,
  };
}

function semanticChecks(
  requestedChecks: ReadonlySet<StructuredCheckId>,
  answerText: string | undefined,
): StructuredCheckResult[] {
  const checks: StructuredCheckResult[] = [];
  if (requestedChecks.has("assumption_disclosed")) {
    checks.push(
      checkAnswerText(
        "assumption_disclosed",
        answerText,
        /\b(?:assuming|assumption|assuming that|if your|based on your stated|given your stated)\b/i,
        "Explicit assumption disclosure is missing.",
      ),
    );
  }
  if (requestedChecks.has("tax_caveat_present")) {
    checks.push(
      checkAnswerText(
        "tax_caveat_present",
        answerText,
        /\b(?:tax|taxable|after[-\s]?tax|capital gains?|ordinary income|qualified dividend|tax advisor|jurisdiction|account type)\b/i,
        "Tax/account caveat is missing.",
      ),
    );
  }
  if (requestedChecks.has("target_bands_present")) {
    checks.push(
      checkAnswerText(
        "target_bands_present",
        answerText,
        /\b(?:target bands?|bands?|range|threshold|drift|5\s*%|percentage points?)\b/i,
        "Target band, range, or rebalance threshold guidance is missing.",
      ),
    );
  }
  if (requestedChecks.has("when_not_ideal_present")) {
    checks.push(
      checkAnswerText(
        "when_not_ideal_present",
        answerText,
        /\b(?:not ideal|avoid|bad fit|poor fit|when this fails|where it fails|doesn'?t work|not suitable|watch out)\b/i,
        "When-not-ideal or unsuitability guidance is missing.",
      ),
    );
  }
  return checks;
}

function checkAnswerText(
  checkId: StructuredCheckId,
  answerText: string | undefined,
  pattern: RegExp,
  failureReason: string,
): StructuredCheckResult {
  const passed = typeof answerText === "string" && pattern.test(answerText);
  return structuredResult(checkId, passed, passed ? undefined : failureReason);
}

export function evaluateFrameworkFallbackEligibility(
  input: FrameworkFallbackInput,
): FrameworkFallbackEligibility {
  if (input.contract.frameworkFallback === "not_allowed") {
    return {
      eligible: false,
      active: false,
      mode: "not_applicable",
      reason: "Contract does not allow framework fallback.",
    };
  }

  const hasUnresolvedSymbol = input.evidenceRecords.some(
    (record) =>
      record.evidenceType === "ticker_disambiguation" &&
      (record.caveats.length > 0 ||
        record.entityScope.symbols === undefined ||
        record.entityScope.symbols.length === 0),
  );
  if (!hasUnresolvedSymbol) {
    return {
      eligible: false,
      active: false,
      mode: "not_applicable",
      reason: "No unresolved selected-slice evidence gap was observed.",
    };
  }

  const parityAllowsActive =
    input.parityStatus === "replacement_active" || input.parityStatus === "legacy_removed";
  return {
    eligible: true,
    active: parityAllowsActive,
    mode: parityAllowsActive ? "active" : "diagnostic_only",
    reason: parityAllowsActive
      ? "Selected-slice parity permits active framework fallback."
      : "Selected-slice fallback is recorded diagnostically until parity passes.",
  };
}

function placeholderContract(
  id: AnswerContractId,
  taskFamily: TaskFamily,
  commitmentMode: CommitmentMode,
  requiredFinalFields: FinalAnswerField[],
): AnswerContractDefinition {
  return {
    id,
    taskFamily,
    commitmentMode,
    implemented: false,
    requiredEvidenceTypes: [],
    requiredFinalFields,
    requiresFreshness: false,
    requiresDataGapDisclosure: requiredFinalFields.includes("data_gap_disclosure"),
    requiresRiskDownside: requiredFinalFields.includes("risk_downside"),
    requiresSourceCoverage: requiredFinalFields.includes("source_coverage"),
    requiresConcreteCommitment:
      COMMITMENT_MODE_CONTRACTS[commitmentMode].requiresConcreteCommitment,
    capabilityGapIds: [],
    frameworkFallback: "not_allowed",
  };
}

function checkRequiredEvidence(
  contract: AnswerContractDefinition,
  evidenceRecords: PlanningEvidenceRecord[],
): StructuredCheckResult {
  const evidenceTypes = new Set(evidenceRecords.map((record) => record.evidenceType));
  const missing = contract.requiredEvidenceTypes.filter((type) => !evidenceTypes.has(type));
  return structuredResult(
    "required_evidence_present",
    missing.length === 0,
    missing.length > 0 ? `Missing evidence types: ${missing.join(", ")}` : undefined,
  );
}

function checkFreshness(
  contract: AnswerContractDefinition,
  metadata: FinalAnswerMetadata,
): StructuredCheckResult {
  if (!contract.requiresFreshness) return structuredResult("freshness_disclosed", true);
  const present =
    metadata.finalFields.includes("freshness_disclosure") && metadata.freshness !== undefined;
  return structuredResult(
    "freshness_disclosed",
    present,
    present ? undefined : "Freshness metadata or freshness disclosure field is missing.",
  );
}

function checkDataGapDisclosure(
  contract: AnswerContractDefinition,
  evidenceRecords: PlanningEvidenceRecord[],
  metadata: FinalAnswerMetadata,
): StructuredCheckResult {
  if (!contract.requiresDataGapDisclosure) return structuredResult("data_gap_disclosed", true);
  const evidenceHasGaps = evidenceRecords.some((record) => record.gaps.length > 0);
  const fieldPresent = metadata.finalFields.includes("data_gap_disclosure");
  const disclosedProvider = (metadata.disclosedProviderStatuses?.length ?? 0) > 0;
  const disclosedCapability = (metadata.disclosedCapabilityGapIds?.length ?? 0) > 0;
  const passed = fieldPresent && (!evidenceHasGaps || disclosedProvider || disclosedCapability);
  return structuredResult(
    "data_gap_disclosed",
    passed,
    passed ? undefined : "Data-gap disclosure metadata does not cover observed evidence gaps.",
  );
}

function checkCommitmentMode(
  contract: AnswerContractDefinition,
  metadata: FinalAnswerMetadata,
): StructuredCheckResult {
  const modeContract = COMMITMENT_MODE_CONTRACTS[contract.commitmentMode];
  const fields = new Set(metadata.finalFields);
  const requiredFieldsPresent = modeContract.requiredFinalFields.every((field) =>
    fields.has(field),
  );
  const passed =
    metadata.commitmentMode === contract.commitmentMode &&
    requiredFieldsPresent &&
    (!contract.requiresConcreteCommitment || fields.has("clear_commitment"));
  return structuredResult(
    "commitment_mode_respected",
    passed,
    passed
      ? undefined
      : `Expected ${contract.commitmentMode} metadata and fields: ${modeContract.requiredFinalFields.join(", ")}`,
  );
}

function checkRequiredFinalFields(
  contract: AnswerContractDefinition,
  metadata: FinalAnswerMetadata,
): StructuredCheckResult {
  const fields = new Set(metadata.finalFields);
  const missing = contract.requiredFinalFields.filter((field) => !fields.has(field));
  return structuredResult(
    "required_final_fields_present",
    missing.length === 0,
    missing.length > 0 ? `Missing required final fields: ${missing.join(", ")}` : undefined,
  );
}

function checkSourceCoverage(
  contract: AnswerContractDefinition,
  metadata: FinalAnswerMetadata,
): StructuredCheckResult {
  if (!contract.requiresSourceCoverage) return structuredResult("source_coverage_disclosed", true);
  const present =
    metadata.finalFields.includes("source_coverage") &&
    metadata.sourceCoverage !== undefined &&
    metadata.sourceCoverage.sources.length > 0;
  return structuredResult(
    "source_coverage_disclosed",
    present,
    present ? undefined : "Source-coverage metadata is missing.",
  );
}

function checkCapabilityGapDisclosure(
  contract: AnswerContractDefinition,
  evidenceRecords: PlanningEvidenceRecord[],
  metadata: FinalAnswerMetadata,
): StructuredCheckResult {
  const required = new Set<CapabilityGapId>(contract.capabilityGapIds);
  for (const record of evidenceRecords) {
    for (const gap of record.gaps) {
      if (gap.capabilityGapId) required.add(gap.capabilityGapId);
    }
  }
  if (required.size === 0) return structuredResult("capability_gap_disclosure", true);

  const disclosed = new Set(metadata.disclosedCapabilityGapIds ?? []);
  const missing = [...required].filter((gapId) => !disclosed.has(gapId));
  return structuredResult(
    "capability_gap_disclosure",
    missing.length === 0,
    missing.length > 0 ? `Missing capability-gap disclosures: ${missing.join(", ")}` : undefined,
  );
}

function structuredResult(
  checkId: StructuredCheckId,
  passed: boolean,
  failureReason?: string,
): StructuredCheckResult {
  return {
    checkId,
    passed,
    observedOnly: true,
    failureReason,
  };
}
