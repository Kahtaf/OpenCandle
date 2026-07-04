import type {
  CapabilityGapId,
  CommitmentMode,
  StructuredCheckId,
} from "../../src/routing/planning.js";
import type { ClassificationResult, WorkflowType } from "../../src/routing/types.js";
import type {
  RetryEligibilityTrace,
  StructuredCheckResult,
} from "../../src/runtime/answer-contracts.js";
import type { ArtifactContractId } from "../../src/runtime/artifact-contracts.js";
import type { PlanningEvidenceRecord } from "../../src/runtime/planning-evidence.js";
import type { CustomEntryTrace } from "../harness/types.js";
import type { SeededMarketStateFixture } from "./competitive-finance.js";
import type { SavedMarketStateFidelityAssertion } from "./scorers/saved-market-state-fidelity.js";

/** Shape of tool call data captured in a trace. */
export interface TraceToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
  promptIndex?: number;
}

export interface RouterTelemetry {
  routeKind?: string;
  legacyRoute?: string;
  workflow?: string;
  missingRequired?: string[];
  toolBundles?: string[];
  activeToolNames?: string[];
  memoryCategories?: string[];
  memoryProvenance?: unknown[];
  diagnostics?: unknown[];
  toolScope?: unknown[];
  toolScopeViolations?: unknown[];
}

export interface PlanningTelemetry {
  version?: string;
  taskFamily?: string;
  commitmentMode?: CommitmentMode;
  policyCardId?: string;
  evidencePlanId?: string;
  answerContractId?: string;
  structuredCheckIds: StructuredCheckId[];
  workspacePlaceholderIds: string[];
  artifactPlaceholderIds: string[];
  artifactContractIds: ArtifactContractId[];
  capabilityGapIds: CapabilityGapId[];
  evidenceRecords: PlanningEvidenceRecord[];
  structuredCheckResults: StructuredCheckResult[];
  structuredCheckFailures: StructuredCheckResult[];
  retryEligibility: RetryEligibilityTrace;
  parityStatus?: string;
  regressionClassification?: string;
}

/** Structured trace emitted by the test harness. */
export interface EvalTrace {
  prompt: string;
  classification: ClassificationResult;
  router?: RouterTelemetry;
  planning?: PlanningTelemetry;
  toolCalls: TraceToolCall[];
  askUserTranscript: Array<{ question: string; answer: string | null }>;
  text: string;
  customEntries?: CustomEntryTrace[];
}

/** A single eval case definition. */
export interface EvalCase {
  name: string;
  tier: "always" | "usually";
  prompt: string;
  /** Ordered answers for multi-turn ask_user scripting, consumed in sequence. */
  answers?: string[];
  /** Optional deterministic saved market-state fixture seeded into the harness home. */
  savedMarketStateFixture?: SeededMarketStateFixture;
  assertions: {
    // Layer 1: Workflow classification
    expectedWorkflow?: WorkflowType;
    // Layer 2: Tool selection
    requiredTools?: string[];
    forbiddenTools?: string[];
    // Layer 3: Tool arguments
    requiredArgs?: Record<string, Record<string, unknown>>;
    // Layer 4: Data faithfulness
    dataFaithfulness?: boolean;
    // Layer 5: Risk disclosure
    responseContains?: (string | RegExp)[];
    responseNotContains?: (string | RegExp)[];
    // Layer 6-7: LLM-judge
    rubric?: string[];
    // Saved-state fidelity: trace context + final answer values.
    savedMarketStateFidelity?: SavedMarketStateFidelityAssertion;
  };
}

/** Per-layer scoring detail for a single eval case. */
export interface LayerDetail {
  passed: boolean;
  score: number;
  message?: string;
}

/** Result of scoring a single eval case. */
export interface EvalCaseResult {
  name: string;
  tier: "always" | "usually";
  score: number;
  layers: Record<string, LayerDetail>;
  safetyCriticalFailure: boolean;
}

/** Aggregate eval report with baseline comparison. */
export interface EvalReport {
  cases: EvalCaseResult[];
  aggregate: number;
  baseline: number | null;
  delta: number | null;
  regression: boolean;
  safetyCriticalFailures: string[];
  improved: string[];
  regressed: string[];
  unchanged: string[];
}
