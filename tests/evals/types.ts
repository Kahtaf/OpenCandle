import type { ClassificationResult, WorkflowType } from "../../src/routing/types.js";

/** Shape of tool call data captured in a trace. */
export interface TraceToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

/** Structured trace emitted by the test harness. */
export interface EvalTrace {
  prompt: string;
  classification: ClassificationResult;
  toolCalls: TraceToolCall[];
  askUserTranscript: Array<{ question: string; answer: string | null }>;
  text: string;
}

/** A single eval case definition. */
export interface EvalCase {
  name: string;
  tier: "always" | "usually";
  prompt: string;
  /** Ordered answers for multi-turn ask_user scripting, consumed in sequence. */
  answers?: string[];
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
