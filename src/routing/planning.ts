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
  | "options_strategy"
  | "current_event_explanation"
  | "ticker_disambiguation"
  | "filing_thesis_review"
  | "sentiment_snapshot"
  | "concept_explainer"
  | "retail_finance_tradeoff"
  | "stateful_tracking_update"
  | "backtest_review"
  | "macro_allocation_review"
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
  | "options_strategy"
  | "current_event_explanation"
  | "ticker_disambiguation"
  | "sentiment_snapshot"
  | "filing_thesis_review"
  | "retail_finance_tradeoff"
  | "concept_explainer"
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
  | "placeholder_general_fallback";

export type AnswerContractId =
  | "single_asset_decision"
  | "asset_compare_tradeoff"
  | "portfolio_build"
  | "portfolio_review"
  | "options_strategy"
  | "current_event_explanation"
  | "ticker_disambiguation"
  | "sentiment_snapshot"
  | "filing_thesis_review"
  | "retail_tradeoff_framework"
  | "concept_explainer"
  | "general_fallback";

export type StructuredCheckId =
  | "required_evidence_present"
  | "freshness_disclosed"
  | "data_gap_disclosed"
  | "commitment_mode_respected"
  | "source_coverage_disclosed"
  | "capability_gap_disclosure";

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
    description: "Exchange holiday and session-state data beyond deterministic weekday/known-holiday grounding.",
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
    description: "Live brokerage fees, platform features, account support, and execution-quality comparison data.",
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
    description: "Upcoming earnings timing, transcript, implied move, and event-specific risk coverage.",
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
    description: "Coverage, sample-size, source-depth, and low-volume confidence metadata for sentiment evidence.",
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
  diagnostics: RouterDiagnostic[];
}

interface PlanningManifestEntry extends PlanningSelection {
  routeKinds: RouterRouteKind[];
  workflows: Array<Exclude<WorkflowType, "unclassified"> | undefined>;
  compatibleToolBundles: ToolBundleName[];
  migrated: boolean;
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
  },
  asset_compare: {
    routeKinds: ["workflow_dispatch", "agent_task"],
    workflows: ["compare_assets"],
    taskFamily: "asset_compare",
    commitmentMode: "compare_tradeoffs",
    policyCardId: "asset_compare",
    evidencePlanId: "placeholder_asset_compare",
    answerContractId: "asset_compare_tradeoff",
    structuredCheckIds: ["required_evidence_present", "data_gap_disclosed", "capability_gap_disclosure"],
    capabilityGapIds: ["etf_holdings_overlap"],
    compatibleToolBundles: ["core_market", "macro", "sentiment", "clarification"],
    migrated: false,
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
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa"],
    taskFamily: "portfolio_review",
    commitmentMode: "decision",
    policyCardId: "portfolio_review",
    evidencePlanId: "placeholder_portfolio_review",
    answerContractId: "portfolio_review",
    structuredCheckIds: ["required_evidence_present", "data_gap_disclosed", "commitment_mode_respected"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "macro", "sentiment", "clarification"],
    migrated: false,
  },
  options_strategy: {
    routeKinds: ["workflow_dispatch", "agent_task"],
    workflows: ["options_screener"],
    taskFamily: "options_strategy",
    commitmentMode: "decision",
    policyCardId: "options_strategy",
    evidencePlanId: "placeholder_options_strategy",
    answerContractId: "options_strategy",
    structuredCheckIds: ["required_evidence_present", "freshness_disclosed"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "options", "sentiment", "clarification"],
    migrated: false,
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
  },
  ticker_disambiguation: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa", undefined],
    taskFamily: "ticker_disambiguation",
    commitmentMode: "framework",
    policyCardId: "ticker_disambiguation",
    evidencePlanId: "ticker_disambiguation",
    answerContractId: "ticker_disambiguation",
    structuredCheckIds: ["required_evidence_present", "data_gap_disclosed"],
    capabilityGapIds: ["earnings_event_risk"],
    compatibleToolBundles: ["core_market", "clarification"],
    migrated: false,
  },
  filing_thesis_review: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa"],
    taskFamily: "filing_thesis_review",
    commitmentMode: "framework",
    policyCardId: "filing_thesis_review",
    evidencePlanId: "placeholder_filing_thesis_review",
    answerContractId: "filing_thesis_review",
    structuredCheckIds: ["required_evidence_present", "data_gap_disclosed"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "sec"],
    migrated: false,
  },
  sentiment_snapshot: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa"],
    taskFamily: "sentiment_snapshot",
    commitmentMode: "framework",
    policyCardId: "sentiment_snapshot",
    evidencePlanId: "placeholder_sentiment_snapshot",
    answerContractId: "sentiment_snapshot",
    structuredCheckIds: ["required_evidence_present", "source_coverage_disclosed", "data_gap_disclosed"],
    capabilityGapIds: ["sentiment_sample_depth"],
    compatibleToolBundles: ["core_market", "sentiment"],
    migrated: false,
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
  },
  stateful_tracking_update: {
    routeKinds: ["agent_task"],
    workflows: ["watchlist_or_tracking"],
    taskFamily: "stateful_tracking_update",
    commitmentMode: "update_state",
    policyCardId: "general_fallback",
    evidencePlanId: "placeholder_general_fallback",
    answerContractId: "general_fallback",
    structuredCheckIds: ["commitment_mode_respected"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market", "clarification"],
    migrated: false,
  },
  backtest_review: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa"],
    taskFamily: "backtest_review",
    commitmentMode: "framework",
    policyCardId: "general_fallback",
    evidencePlanId: "placeholder_general_fallback",
    answerContractId: "general_fallback",
    structuredCheckIds: ["required_evidence_present"],
    capabilityGapIds: [],
    compatibleToolBundles: ["core_market"],
    migrated: false,
  },
  macro_allocation_review: {
    routeKinds: ["agent_task"],
    workflows: ["general_finance_qa"],
    taskFamily: "macro_allocation_review",
    commitmentMode: "decision",
    policyCardId: "portfolio_review",
    evidencePlanId: "market_status",
    answerContractId: "portfolio_review",
    structuredCheckIds: ["required_evidence_present", "freshness_disclosed", "data_gap_disclosed"],
    capabilityGapIds: ["market_calendar", "forward_rate_probabilities"],
    compatibleToolBundles: ["core_market", "macro", "sentiment", "clarification"],
    migrated: false,
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
): PlanningEnvelope {
  const proposed = defaultPlanningSelection(input, output);
  const { selection, diagnostics } = validatePlanningSelection(output, proposed);
  const behaviorMode: PlanningBehaviorMode = PLANNING_MANIFEST[selection.taskFamily].migrated
    ? "dual_run"
    : "observe_only";

  return {
    version: PLANNING_VERSION,
    ...selection,
    behaviorMode,
    workspacePlaceholderIds: [],
    artifactPlaceholderIds: [],
    diagnostics: [
      ...diagnostics,
      ...(output.diagnostics.length > 0
        ? [{
            code: "planning_after_router_corrections",
            message: "planning selected after router diagnostics were applied",
          }]
        : []),
      ...(behaviorMode === "observe_only"
        ? [{
            code: "planning_observe_only",
            message: "planning metadata is recorded without changing active prompt, route, workflow, tools, or answer behavior",
          }]
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
    diagnostics: [{
      code: "planning_task_family_corrected",
      message: `${proposed.taskFamily} is not supported for ${output.routeKind}${output.workflow ? `/${output.workflow}` : ""}; using ${fallback}`,
    }],
  };
}

function defaultPlanningSelection(
  input: RouterInputContext,
  output: RouterOutput,
): PlanningSelection {
  return selectionForTaskFamily(defaultTaskFamilyForOutput(output, input.text));
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
  if (output.routeKind === "clarification") return "general_fallback";
  if (output.routeKind === "pass_through") return "general_fallback";
  if (output.workflow === "portfolio_builder") return "portfolio_build";
  if (output.workflow === "options_screener") return "options_strategy";
  if (output.workflow === "compare_assets") return "asset_compare";
  if (output.workflow === "watchlist_or_tracking") return "stateful_tracking_update";
  if (output.workflow === "single_asset_analysis") return "single_asset_decision";

  const lower = text.toLowerCase();
  if (/\b(?:60\/40|portfolio|allocation)\b/.test(lower) && /\b(?:evaluate|evaluation|review|risk|prospects)\b/.test(lower)) {
    return "portfolio_review";
  }
  if (output.entities.symbols.length === 1 && /\b(?:analyze|buy|sell|wait|avoid|recommendation|attractive)\b/.test(lower)) {
    return "single_asset_decision";
  }
  if (/\b(?:macro|inflation|fed|rates?|duration|recession)\b/.test(lower)) {
    return "macro_allocation_review";
  }
  if (/\b(?:today|right now|this morning|after close|moved|catalyst)\b/.test(lower)) {
    return "current_event_explanation";
  }
  if (/\b(?:ticker|symbol|formerly|old ticker|earnings are|earnings tonight)\b/.test(lower)) {
    return "ticker_disambiguation";
  }
  if (/\b(?:filing|10-k|10-q|8-k|sec)\b/.test(lower)) {
    return "filing_thesis_review";
  }
  if (/\b(?:sentiment|mood|reddit|twitter|x\/twitter)\b/.test(lower)) {
    return "sentiment_snapshot";
  }
  if (/\b(?:brokerage|hysa|money-market|t-bills?|cds?|mortgage|taxable account)\b/.test(lower)) {
    return "retail_finance_tradeoff";
  }
  if (/\b(?:explain|what is|what does|how to|define)\b/.test(lower) && output.entities.symbols.length === 0) {
    return "concept_explainer";
  }
  return "general_fallback";
}

function isAllowedForOutput(entry: PlanningManifestEntry, output: RouterOutput): boolean {
  if (!entry.routeKinds.includes(output.routeKind)) return false;
  return entry.workflows.includes(output.workflow);
}
