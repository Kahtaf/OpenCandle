import {
  type ArtifactContractId,
  artifactContractIdsForPlanning,
} from "../runtime/artifact-contracts.js";
import type {
  RouterDiagnostic,
  RouterInputContext,
  RouterOutput,
  RouterRouteKind,
  ToolBundleName,
} from "./router-types.js";
import type { WorkflowType } from "./types.js";

export const PLANNING_VERSION = "planning-v1" as const;

export type TaskFamily =
  | "single_asset_decision"
  | "asset_compare"
  | "portfolio_build"
  | "portfolio_review"
  | "macro_allocation_review"
  | "options_strategy"
  | "current_event_explanation"
  | "ticker_disambiguation"
  | "filing_thesis_review"
  | "sentiment_snapshot"
  | "concept_explainer"
  | "retail_finance_tradeoff"
  | "stateful_tracking_update"
  | "backtest_review"
  | "general_fallback";

export type CommitmentMode =
  | "decision"
  | "compare_tradeoffs"
  | "framework"
  | "construct"
  | "update_state"
  | "clarify";

export type PolicyCardId =
  | "single_asset_decision"
  | "asset_compare"
  | "portfolio_build"
  | "portfolio_review"
  | "portfolio_rebalance_review"
  | "macro_allocation_review"
  | "options_strategy"
  | "current_event_explanation"
  | "ticker_disambiguation"
  | "sentiment_snapshot"
  | "filing_thesis_review"
  | "retail_finance_tradeoff"
  | "concept_explainer"
  | "concept_options_education"
  | "concept_inflation_cash_education"
  | "concept_valuation_metric_education"
  | "backtest_review"
  | "stateful_tracking_update"
  | "general_fallback";

export type EvidencePlanId =
  | "market_status"
  | "ticker_disambiguation"
  | "placeholder_single_asset_decision"
  | "placeholder_asset_compare"
  | "placeholder_portfolio_build"
  | "placeholder_portfolio_review"
  | "placeholder_options_strategy"
  | "placeholder_current_event_explanation"
  | "placeholder_sentiment_snapshot"
  | "placeholder_filing_thesis_review"
  | "placeholder_retail_finance_tradeoff"
  | "placeholder_concept_explainer"
  | "placeholder_backtest_review"
  | "placeholder_stateful_tracking_update"
  | "placeholder_general_fallback";

export type AnswerContractId =
  | "single_asset_decision"
  | "asset_compare_tradeoff"
  | "portfolio_build"
  | "portfolio_review"
  | "macro_allocation_review"
  | "options_strategy"
  | "current_event_explanation"
  | "ticker_disambiguation"
  | "sentiment_snapshot"
  | "filing_thesis_review"
  | "retail_tradeoff_framework"
  | "concept_explainer"
  | "backtest_review"
  | "stateful_tracking_update"
  | "general_fallback";

export type StructuredCheckId =
  | "required_evidence_present"
  | "freshness_disclosed"
  | "data_gap_disclosed"
  | "commitment_mode_respected"
  | "required_final_fields_present"
  | "source_coverage_disclosed"
  | "capability_gap_disclosure"
  | "assumption_disclosed"
  | "tax_caveat_present"
  | "target_bands_present"
  | "when_not_ideal_present";

export type CapabilityGapId =
  | "market_calendar"
  | "etf_holdings_overlap"
  | "brokerage_comparison"
  | "cash_yield_products"
  | "earnings_event_risk"
  | "fund_tax_efficiency"
  | "forward_rate_probabilities"
  | "sentiment_sample_depth";

export interface CapabilityGapDefinition {
  id: CapabilityGapId;
  label: string;
  description: string;
  v1Status: "classified_gap";
  specialistCompetitive: boolean;
}

export const CAPABILITY_GAP_REGISTRY: Record<CapabilityGapId, CapabilityGapDefinition> = {
  market_calendar: {
    id: "market_calendar",
    label: "Market calendar",
    description:
      "Exchange holiday and session-state data beyond deterministic weekday/known-holiday grounding.",
    v1Status: "classified_gap",
    specialistCompetitive: false,
  },
  etf_holdings_overlap: {
    id: "etf_holdings_overlap",
    label: "ETF holdings overlap",
    description: "Exact fund holding overlap, weights, and issuer-level exposure calculations.",
    v1Status: "classified_gap",
    specialistCompetitive: false,
  },
  brokerage_comparison: {
    id: "brokerage_comparison",
    label: "Brokerage comparison",
    description:
      "Live brokerage fees, platform features, account support, and execution-quality comparison data.",
    v1Status: "classified_gap",
    specialistCompetitive: false,
  },
  cash_yield_products: {
    id: "cash_yield_products",
    label: "Cash-yield products",
    description: "Live HYSA, money-market, CD, T-bill, and sweep-rate comparison data.",
    v1Status: "classified_gap",
    specialistCompetitive: false,
  },
  earnings_event_risk: {
    id: "earnings_event_risk",
    label: "Earnings-event risk",
    description:
      "Upcoming earnings timing, transcript, implied move, and event-specific risk coverage.",
    v1Status: "classified_gap",
    specialistCompetitive: false,
  },
  fund_tax_efficiency: {
    id: "fund_tax_efficiency",
    label: "Fund tax efficiency",
    description: "Distribution, turnover, asset-location, and after-tax fund comparison data.",
    v1Status: "classified_gap",
    specialistCompetitive: false,
  },
  forward_rate_probabilities: {
    id: "forward_rate_probabilities",
    label: "Forward-rate probabilities",
    description: "Forward policy-rate probability and curve-derived expectation data.",
    v1Status: "classified_gap",
    specialistCompetitive: false,
  },
  sentiment_sample_depth: {
    id: "sentiment_sample_depth",
    label: "Sentiment sample depth",
    description:
      "Coverage, sample-size, source-depth, and low-volume confidence metadata for sentiment evidence.",
    v1Status: "classified_gap",
    specialistCompetitive: false,
  },
};

export type PlanningBehaviorMode = "observe_only" | "dual_run" | "replacement_active";

export interface PlanningSelection {
  taskFamily: TaskFamily;
  commitmentMode: CommitmentMode;
  policyCardId: PolicyCardId;
  evidencePlanId: EvidencePlanId;
  answerContractId: AnswerContractId;
  structuredCheckIds: StructuredCheckId[];
  capabilityGapIds: CapabilityGapId[];
}

export interface PlanningEnvelope extends PlanningSelection {
  version: typeof PLANNING_VERSION;
  behaviorMode: PlanningBehaviorMode;
  workspacePlaceholderIds: string[];
  artifactPlaceholderIds: string[];
  artifactContractIds?: ArtifactContractId[];
  diagnostics: RouterDiagnostic[];
}

export interface PlanningBuildOptions {
  migrationStatuses?: Partial<Record<TaskFamily, PlanningBehaviorMode>>;
}

interface PlanningManifestEntry extends PlanningSelection {
  routeKinds: RouterRouteKind[];
  workflows: Array<Exclude<WorkflowType, "unclassified"> | undefined>;
  compatibleToolBundles: ToolBundleName[];
  migrated: boolean;
  migrationStatus?: PlanningBehaviorMode;
}

export const PLANNING_MANIFEST: Record<TaskFamily, PlanningManifestEntry> = {
  single_asset_decision: {
    routeKinds: ["agent_task"],
    workflows: ["single_asset_analysis", "general_finance_qa", undefined],
    taskFamily: "single_asset_decision",
    commitmentMode: "decision",
    policyCardId: "single_asset_decision",
    evidencePlanId: "placeholder_single_asset_decision",
    answerContractId: "single_asset_decision",
    structuredCheckIds: ["required_evidence_present", "freshness_disclosed", "data_gap_disclosed"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "options", "sentiment", "sec", "clarification"],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  asset_compare: {
    routeKinds: ["workflow_dispatch", "agent_task"],
    workflows: ["compare_assets"],
    taskFamily: "asset_compare",
    commitmentMode: "compare_tradeoffs",
    policyCardId: "asset_compare",
    evidencePlanId: "placeholder_asset_compare",
    answerContractId: "asset_compare_tradeoff",
    structuredCheckIds: [
      "required_evidence_present",
      "data_gap_disclosed",
      "capability_gap_disclosure",
    ],
    capabilityGapIds: ["etf_holdings_overlap"],
    compatibleToolBundles: ["core_market", "macro", "sentiment", "clarification"],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  portfolio_build: {
    routeKinds: ["workflow_dispatch"],
    workflows: ["portfolio_builder"],
    taskFamily: "portfolio_build",
    commitmentMode: "construct",
    policyCardId: "portfolio_build",
    evidencePlanId: "placeholder_portfolio_build",
    answerContractId: "portfolio_build",
    structuredCheckIds: ["required_evidence_present", "commitment_mode_respected"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "macro", "sentiment", "clarification"],
    migrated: false,
  },
  portfolio_review: {
    routeKinds: ["agent_task", "workflow_dispatch"],
    workflows: ["general_finance_qa", "portfolio_builder"],
    taskFamily: "portfolio_review",
    commitmentMode: "decision",
    policyCardId: "portfolio_review",
    evidencePlanId: "placeholder_portfolio_review",
    answerContractId: "portfolio_review",
    structuredCheckIds: [
      "required_evidence_present",
      "data_gap_disclosed",
      "commitment_mode_respected",
    ],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "macro", "sentiment", "clarification"],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  options_strategy: {
    routeKinds: ["workflow_dispatch", "agent_task"],
    workflows: ["options_screener", "general_finance_qa"],
    taskFamily: "options_strategy",
    commitmentMode: "decision",
    policyCardId: "options_strategy",
    evidencePlanId: "placeholder_options_strategy",
    answerContractId: "options_strategy",
    structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "options", "sentiment", "clarification"],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  current_event_explanation: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa", "single_asset_analysis", undefined],
    taskFamily: "current_event_explanation",
    commitmentMode: "framework",
    policyCardId: "current_event_explanation",
    evidencePlanId: "market_status",
    answerContractId: "current_event_explanation",
    structuredCheckIds: ["required_evidence_present", "freshness_disclosed", "data_gap_disclosed"],
    capabilityGapIds: ["market_calendar"],
    compatibleToolBundles: ["core_market", "macro", "sentiment", "sec", "clarification"],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  ticker_disambiguation: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa", "single_asset_analysis", undefined],
    taskFamily: "ticker_disambiguation",
    commitmentMode: "framework",
    policyCardId: "ticker_disambiguation",
    evidencePlanId: "ticker_disambiguation",
    answerContractId: "ticker_disambiguation",
    structuredCheckIds: ["required_evidence_present", "data_gap_disclosed"],
    capabilityGapIds: ["earnings_event_risk"],
    compatibleToolBundles: ["core_market", "clarification"],
    migrated: true,
  },
  filing_thesis_review: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa", "single_asset_analysis"],
    taskFamily: "filing_thesis_review",
    commitmentMode: "framework",
    policyCardId: "filing_thesis_review",
    evidencePlanId: "placeholder_filing_thesis_review",
    answerContractId: "filing_thesis_review",
    structuredCheckIds: ["required_evidence_present", "data_gap_disclosed"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "sec"],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  sentiment_snapshot: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa", "single_asset_analysis"],
    taskFamily: "sentiment_snapshot",
    commitmentMode: "framework",
    policyCardId: "sentiment_snapshot",
    evidencePlanId: "placeholder_sentiment_snapshot",
    answerContractId: "sentiment_snapshot",
    structuredCheckIds: [
      "required_evidence_present",
      "source_coverage_disclosed",
      "data_gap_disclosed",
    ],
    capabilityGapIds: ["sentiment_sample_depth"],
    compatibleToolBundles: ["core_market", "sentiment"],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  concept_explainer: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa", undefined],
    taskFamily: "concept_explainer",
    commitmentMode: "framework",
    policyCardId: "concept_explainer",
    evidencePlanId: "placeholder_concept_explainer",
    answerContractId: "concept_explainer",
    structuredCheckIds: ["commitment_mode_respected"],
    capabilityGapIds: [],
    compatibleToolBundles: [],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  retail_finance_tradeoff: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa", undefined],
    taskFamily: "retail_finance_tradeoff",
    commitmentMode: "framework",
    policyCardId: "retail_finance_tradeoff",
    evidencePlanId: "placeholder_retail_finance_tradeoff",
    answerContractId: "retail_tradeoff_framework",
    structuredCheckIds: ["data_gap_disclosed", "capability_gap_disclosure"],
    capabilityGapIds: ["brokerage_comparison", "cash_yield_products", "fund_tax_efficiency"],
    compatibleToolBundles: [],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  stateful_tracking_update: {
    routeKinds: ["agent_task"],
    workflows: ["watchlist_or_tracking"],
    taskFamily: "stateful_tracking_update",
    commitmentMode: "update_state",
    policyCardId: "stateful_tracking_update",
    evidencePlanId: "placeholder_stateful_tracking_update",
    answerContractId: "stateful_tracking_update",
    structuredCheckIds: ["commitment_mode_respected"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "clarification"],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  backtest_review: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa", "single_asset_analysis"],
    taskFamily: "backtest_review",
    commitmentMode: "framework",
    policyCardId: "backtest_review",
    evidencePlanId: "placeholder_backtest_review",
    answerContractId: "backtest_review",
    structuredCheckIds: [
      "required_evidence_present",
      "data_gap_disclosed",
      "source_coverage_disclosed",
    ],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "options", "sentiment", "sec", "clarification"],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  macro_allocation_review: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa"],
    taskFamily: "macro_allocation_review",
    commitmentMode: "decision",
    policyCardId: "macro_allocation_review",
    evidencePlanId: "market_status",
    answerContractId: "macro_allocation_review",
    structuredCheckIds: ["required_evidence_present", "freshness_disclosed", "data_gap_disclosed"],
    capabilityGapIds: ["market_calendar", "forward_rate_probabilities"],
    compatibleToolBundles: ["core_market", "macro", "sentiment", "clarification"],
    migrated: false,
    migrationStatus: "replacement_active",
  },
  general_fallback: {
    routeKinds: ["agent_task", "clarification", "pass_through"],
    workflows: [undefined, "general_finance_qa"],
    taskFamily: "general_fallback",
    commitmentMode: "framework",
    policyCardId: "general_fallback",
    evidencePlanId: "placeholder_general_fallback",
    answerContractId: "general_fallback",
    structuredCheckIds: ["data_gap_disclosed"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "clarification"],
    migrated: false,
  },
};

export function buildPlanningEnvelope(
  input: RouterInputContext,
  output: RouterOutput,
  options: PlanningBuildOptions = {},
): PlanningEnvelope {
  const proposed = defaultPlanningSelection(input, output);
  const { selection, diagnostics } = validatePlanningSelection(output, proposed);
  const manifestEntry = PLANNING_MANIFEST[selection.taskFamily];
  const behaviorMode: PlanningBehaviorMode =
    options.migrationStatuses?.[selection.taskFamily] ??
    manifestEntry.migrationStatus ??
    (manifestEntry.migrated ? "replacement_active" : "observe_only");

  return {
    version: PLANNING_VERSION,
    ...selection,
    behaviorMode,
    workspacePlaceholderIds: [],
    artifactPlaceholderIds: [],
    artifactContractIds: artifactContractIdsForPlanning(selection),
    diagnostics: [
      ...diagnostics,
      ...(output.diagnostics.length > 0
        ? [
            {
              code: "planning_after_router_corrections",
              message: "planning selected after router diagnostics were applied",
            },
          ]
        : []),
      ...(behaviorMode === "observe_only"
        ? [
            {
              code: "planning_observe_only",
              message:
                "planning metadata is recorded without changing active prompt, route, workflow, tools, or answer behavior",
            },
          ]
        : []),
    ],
  };
}

export function validatePlanningSelection(
  output: RouterOutput,
  proposed: PlanningSelection,
): { selection: PlanningSelection; diagnostics: RouterDiagnostic[] } {
  const manifestEntry = PLANNING_MANIFEST[proposed.taskFamily];
  if (isAllowedForOutput(manifestEntry, output)) {
    return { selection: proposed, diagnostics: [] };
  }

  const fallback = defaultTaskFamilyForOutput(output, "");
  return {
    selection: selectionForTaskFamily(fallback),
    diagnostics: [
      {
        code: "planning_task_family_corrected",
        message: `${proposed.taskFamily} is not supported for ${output.routeKind}${output.workflow ? `/${output.workflow}` : ""}; using ${fallback}`,
      },
    ],
  };
}

function defaultPlanningSelection(
  input: RouterInputContext,
  output: RouterOutput,
): PlanningSelection {
  const selection = selectionForTaskFamily(defaultTaskFamilyForOutput(output, input.text));
  return refinePlanningSelectionForPrompt(selection, input.text);
}

function selectionForTaskFamily(taskFamily: TaskFamily): PlanningSelection {
  const entry = PLANNING_MANIFEST[taskFamily];
  return {
    taskFamily: entry.taskFamily,
    commitmentMode: entry.commitmentMode,
    policyCardId: entry.policyCardId,
    evidencePlanId: entry.evidencePlanId,
    answerContractId: entry.answerContractId,
    structuredCheckIds: [...entry.structuredCheckIds],
    capabilityGapIds: [...entry.capabilityGapIds],
  };
}

function defaultTaskFamilyForOutput(output: RouterOutput, text: string): TaskFamily {
  const lower = text.toLowerCase();
  if (output.routeKind === "clarification") return "general_fallback";
  if (output.routeKind === "pass_through") return "general_fallback";
  if (
    output.workflow === "portfolio_builder" &&
    isExistingRetirementAllocationReviewPrompt(lower)
  ) {
    return "portfolio_review";
  }
  if (output.workflow === "portfolio_builder") return "portfolio_build";
  if (output.workflow === "options_screener") return "options_strategy";
  if (output.workflow === "compare_assets") return "asset_compare";
  if (output.workflow === "watchlist_or_tracking") return "stateful_tracking_update";

  if (output.entities.symbols.length === 0 && isNoToolConceptEducationPrompt(lower)) {
    return "concept_explainer";
  }
  if (isTickerDisambiguationPrompt(lower)) {
    return "ticker_disambiguation";
  }
  if (isOptionsStrategyPrompt(lower)) return "options_strategy";
  if (/\bbacktest(?:ing|ed)?\b/.test(lower)) {
    return "backtest_review";
  }
  if (
    isPortfolioRebalancePrompt(lower) ||
    isAddToExistingHoldingsPrompt(lower, output.entities.symbols.length)
  ) {
    return "portfolio_review";
  }
  if (/\b(?:macro|inflation|fed|rates?|duration|recession)\b/.test(lower)) {
    return "macro_allocation_review";
  }
  if (/\b(?:sentiment|mood|reddit|twitter|x\/twitter)\b/.test(lower)) {
    return "sentiment_snapshot";
  }
  if (/\b(?:today|right now|this morning|after close|moved|catalyst)\b/.test(lower)) {
    return "current_event_explanation";
  }
  if (/\b(?:filing|10-k|10-q|8-k|sec)\b/.test(lower)) {
    return "filing_thesis_review";
  }
  if (/\b(?:brokerage|hysa|money-market|t-bills?|cds?|mortgage|taxable account)\b/.test(lower)) {
    return "retail_finance_tradeoff";
  }
  if (
    /\b(?:btc|bitcoin|crypto)\b/.test(lower) &&
    /\b(?:allocation|range|position\s+size|sizing|drawdown)\b/.test(lower)
  ) {
    return "retail_finance_tradeoff";
  }
  if (
    /\b(?:60\/40|portfolio|allocation)\b/.test(lower) &&
    /\b(?:evaluate|evaluation|review|risk|prospects)\b/.test(lower)
  ) {
    return "portfolio_review";
  }
  if (
    output.entities.symbols.length === 1 &&
    /\b(?:analyze|buy|sell|wait|avoid|recommendation|attractive)\b/.test(lower)
  ) {
    return "single_asset_decision";
  }
  if (output.workflow === "single_asset_analysis") return "single_asset_decision";
  if (
    /\b(?:explain|what is|what does|how to|define)\b/.test(lower) &&
    output.entities.symbols.length === 0
  ) {
    return "concept_explainer";
  }
  return "general_fallback";
}

function refinePlanningSelectionForPrompt(
  selection: PlanningSelection,
  text: string,
): PlanningSelection {
  const lower = text.toLowerCase();

  if (selection.taskFamily === "concept_explainer") {
    if (isOptionsEducationPrompt(lower)) {
      return {
        ...selection,
        policyCardId: "concept_options_education",
        structuredCheckIds: mergeStructuredChecks(selection.structuredCheckIds, [
          "tax_caveat_present",
          "when_not_ideal_present",
        ]),
      };
    }
    if (isInflationCashEducationPrompt(lower)) {
      return {
        ...selection,
        policyCardId: "concept_inflation_cash_education",
        structuredCheckIds: mergeStructuredChecks(selection.structuredCheckIds, [
          "tax_caveat_present",
        ]),
      };
    }
    if (isValuationMetricEducationPrompt(lower)) {
      return {
        ...selection,
        policyCardId: "concept_valuation_metric_education",
      };
    }
  }

  if (
    selection.taskFamily === "portfolio_review" &&
    (isPortfolioRebalancePrompt(lower) || isAddToExistingHoldingsPrompt(lower, 2)) &&
    !isExistingRetirementAllocationReviewPrompt(lower)
  ) {
    return {
      ...selection,
      policyCardId: "portfolio_rebalance_review",
      structuredCheckIds: mergeStructuredChecks(selection.structuredCheckIds, [
        "assumption_disclosed",
        "target_bands_present",
      ]),
      capabilityGapIds: mergeCapabilityGaps(selection.capabilityGapIds, ["etf_holdings_overlap"]),
    };
  }

  if (
    selection.taskFamily === "retail_finance_tradeoff" &&
    /\b(?:where should|hysa|money-market|t-bills?|cds?|mortgage|versus|vs\.?|or)\b/.test(lower)
  ) {
    return {
      ...selection,
      commitmentMode: "compare_tradeoffs",
    };
  }

  if (
    selection.taskFamily === "retail_finance_tradeoff" &&
    /\b(?:btc|bitcoin|crypto)\b/.test(lower) &&
    /\b(?:allocation|range|position\s+size|sizing|drawdown)\b/.test(lower)
  ) {
    return {
      ...selection,
      commitmentMode: "decision",
    };
  }

  if (
    selection.taskFamily === "ticker_disambiguation" &&
    /\b(?:earnings|trim|hedge|hold|event[-\s]?risk|position\s+size)\b/.test(lower)
  ) {
    return {
      ...selection,
      commitmentMode: "decision",
    };
  }

  if (
    selection.taskFamily === "macro_allocation_review" &&
    /\b(?:sentiment|mood|reddit|twitter|x\/twitter)\b/.test(lower)
  ) {
    return {
      ...selection,
      commitmentMode: "framework",
      capabilityGapIds: mergeCapabilityGaps(selection.capabilityGapIds, ["sentiment_sample_depth"]),
    };
  }

  return selection;
}

function isNoToolConceptEducationPrompt(lower: string): boolean {
  if (
    !/\b(?:explain|what\s+is|what\s+are|what\s+does|how\s+does|how\s+do|how\s+to|define)\b/.test(
      lower,
    )
  ) {
    return false;
  }
  return (
    isOptionsEducationPrompt(lower) ||
    isInflationCashEducationPrompt(lower) ||
    isValuationMetricEducationPrompt(lower)
  );
}

function isOptionsEducationPrompt(lower: string): boolean {
  return /\b(?:covered\s+calls?|protective\s+puts?|options?|option\s+premium|assignment\s+risk|strike|expiration|delta|theta|greeks?)\b/.test(
    lower,
  );
}

function isOptionsStrategyPrompt(lower: string): boolean {
  const explicitOptionsStrategy =
    /\b(?:covered\s+calls?|protective\s+puts?|buy(?:ing)?\s+puts?|sell(?:ing)?\s+calls?|sell(?:ing)?\s+puts?|options?\s+income|option\s+strategy|options?\s+hedge|collar)\b/.test(
      lower,
    );
  const optionsHedge =
    /\bhedg(?:e|ing)\b.{0,80}\b(?:puts|put\s+options?|options?)\b/.test(lower) ||
    /\b(?:puts|put\s+options?|options?)\b.{0,80}\bhedg(?:e|ing)\b/.test(lower);
  return (
    (explicitOptionsStrategy || optionsHedge) &&
    /\b(?:own|have|shares?|position|cost\s+basis|good\s+idea|make\s+sense|income|premium|strike|expiration|assignment|stable|flat|protect|hedge|sell)\b/.test(
      lower,
    )
  );
}

function isTickerDisambiguationPrompt(lower: string): boolean {
  if (/\b(?:ticker|symbol|formerly|old ticker)\b/.test(lower)) return true;
  return (
    /\b(?:earnings are|earnings tonight)\b/.test(lower) &&
    /\b(?:trim|hedge|hold|event[-\s]?risk|position\s+size)\b/.test(lower) &&
    !/\b(?:covered\s+calls?|protective\s+puts?|sell(?:ing)?\s+calls?|sell(?:ing)?\s+puts?|option\s+chain|strike|expiration|premium)\b/.test(
      lower,
    )
  );
}

function isInflationCashEducationPrompt(lower: string): boolean {
  return (
    /\b(?:inflation|purchasing\s+power|real\s+returns?|cash\s+savings?|cash\s+drag|tips|short(?:er)?[-\s]?duration)\b/.test(
      lower,
    ) &&
    /\b(?:cash|savings?|purchasing\s+power|real\s+returns?|bonds?|tips|protect|protection|affect)\b/.test(
      lower,
    )
  );
}

function isValuationMetricEducationPrompt(lower: string): boolean {
  return /\b(?:p\/e|pe\s+ratio|price[-\s]?to[-\s]?earnings|ev\/ebitda|p\/s|price[-\s]?to[-\s]?sales|valuation\s+metric|trailing|forward\s+earnings|normalized\s+earnings|cyclically\s+adjusted)\b/.test(
    lower,
  );
}

function isPortfolioRebalancePrompt(lower: string): boolean {
  const hasExplicitPortfolioSubject =
    /\b(?:portfolio|allocation|holdings?|sleeves?|ira|401k|401\(k\)|etfs?|funds?|s&p\s*500|index)\b/.test(
      lower,
    );
  const hasOwnedAssetMix =
    /\b(?:my|current|have|holding|hold|own|invested|positions?|\d+(?:\.\d+)?%)\b/.test(lower) &&
    /\b(?:stocks?|equity|fixed\s+income|bonds?|cash|etfs?|funds?)\b/.test(lower);
  return (
    (hasExplicitPortfolioSubject || hasOwnedAssetMix) &&
    /\b(?:rebalance|diversify|diversifying|concentration|overweight|underweight|expos(?:ed|ure)|target\s+bands?|drift|reduce\s+concentration|adjust(?:ment)?|change|more\s+aggressive|higher\s+growth|too\s+risky|riskier|worried|crash|hedge|protect|protection|missing\s+out\s+on\s+growth)\b/.test(
      lower,
    )
  );
}

function isAddToExistingHoldingsPrompt(lower: string, symbolCount: number): boolean {
  return (
    symbolCount >= 2 &&
    /\b(?:already\s+own|already\s+hold|current(?:ly)?\s+own|existing\s+(?:holdings?|portfolio|position)|my\s+portfolio)\b/.test(
      lower,
    ) &&
    /\b(?:add(?:ing)?|buy(?:ing)?|make\s+sense|fit|long[-\s]?term|growth)\b/.test(lower)
  );
}

function isExistingRetirementAllocationReviewPrompt(lower: string): boolean {
  return (
    /\b(?:401k|401\(k\)|target[-\s]?date|tdf)\b/.test(lower) &&
    /\b(?:mostly|current(?:ly)?|already|have|holding|invested|allocation)\b/.test(lower) &&
    /\b(?:review|solid|worried|inflation|diversify|boost returns?|other options?|without taking crazy risks?|risk)\b/.test(
      lower,
    )
  );
}

function mergeCapabilityGaps(
  primary: readonly CapabilityGapId[],
  secondary: readonly CapabilityGapId[],
): CapabilityGapId[] {
  const merged: CapabilityGapId[] = [];
  for (const gap of [...primary, ...secondary]) {
    if (!merged.includes(gap)) merged.push(gap);
  }
  return merged;
}

function mergeStructuredChecks(
  primary: readonly StructuredCheckId[],
  secondary: readonly StructuredCheckId[],
): StructuredCheckId[] {
  const merged: StructuredCheckId[] = [];
  for (const check of [...primary, ...secondary]) {
    if (!merged.includes(check)) merged.push(check);
  }
  return merged;
}

function isAllowedForOutput(entry: PlanningManifestEntry, output: RouterOutput): boolean {
  if (!entry.routeKinds.includes(output.routeKind)) return false;
  return entry.workflows.includes(output.workflow);
}
