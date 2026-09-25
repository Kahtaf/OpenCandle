/** Structured trace types for the agent test harness. */

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean;
  durationMs: number;
  promptIndex?: number;
}

export interface TurnTrace {
  toolCalls: ToolCallTrace[];
  text: string;
  promptIndex?: number;
}

export interface InteractionTrace {
  question: string;
  method: "select" | "text" | "confirm";
  options?: string[];
  answer: string | null;
  promptIndex?: number;
}

/** Custom session entry captured from the session manager after settle.
 * Populated from entries where `type === "custom"` and `customType` starts
 * with `opencandle-` (e.g. opencandle-router, opencandle-router-error,
 * opencandle-router-prefs-dropped, opencandle-disclaimer, opencandle-turn-gap,
 * opencandle-workflow). Drain occurs before `trace.json` or eval traces are
 * written. See
 * openspec/specs/test-harness-observability/spec.md (folded from the
 * now-archived router-context-and-observability change) Decision 6. */
export interface CustomEntryTrace {
  customType: string;
  data: unknown;
  timestamp: string;
  promptIndex?: number;
}

/** Normalized Pi `stopReason` values, plus `unknown` for anything unexpected. */
export type TerminalStopReason =
  | "pending"
  | "stop"
  | "length"
  | "toolUse"
  | "error"
  | "aborted"
  | "deferred"
  | "unknown";

/**
 * Bounded, non-sensitive classification of the terminal assistant error.
 * The raw provider error message is intentionally never stored.
 */
export type TerminalErrorCategory =
  | "aborted"
  | "authentication"
  | "rate_limit"
  | "timeout"
  | "context_length"
  | "safety"
  | "network"
  | "provider_error"
  | "unknown";

/**
 * Sanitized terminal metadata for the final assistant message of a run.
 *
 * When a run captures an empty or unresolved final answer, the trace must say
 * *why*: a successful-but-blank message (`stopReason: "stop"`, `textEmpty`) is
 * a product outcome, while `error`/`aborted` is a terminal failure. Only the
 * bounded `stopReason` and `errorCategory` cross this boundary — never the raw
 * provider `errorMessage`, which can carry credentials or session values.
 */
export interface TerminalOutcomeTrace {
  stopReason: TerminalStopReason;
  errorPresent: boolean;
  errorCategory?: TerminalErrorCategory;
  textEmpty: boolean;
  promptIndex?: number;
}

export interface RetryEventTrace {
  type: "auto_retry_start" | "auto_retry_end";
  attempt: number;
  delayMs?: number;
  success?: boolean;
  errorCategory?: TerminalErrorCategory;
  promptIndex?: number;
}

export interface AgentTrace {
  prompt: string;
  prompts?: string[];
  turns: TurnTrace[];
  interactions: InteractionTrace[];
  finalText: string;
  toolSequence: string[];
  durationMs: number;
  /** Sanitized terminal outcome of the last assistant message, when observed. */
  terminalOutcome?: TerminalOutcomeTrace;
  retryEvents?: RetryEventTrace[];
  /** OpenCandle extension-authored custom entries, in append order. */
  customEntries?: CustomEntryTrace[];
  /** Why a workflow failed (bounded, redacted); absent when no workflow failed. */
  workflowFailure?: WorkflowFailureSummary;
}

/** One failed output-validation attempt of a workflow step. */
export interface WorkflowValidationAttempt {
  step: string;
  /** 1 for the initial attempt, 2 after the single repair, and so on. */
  attempt: number;
  repairAttempted: boolean;
  /** Redacted, truncated validation error messages. */
  errors: string[];
}

/** One failure row from the durable workflow event log. */
export interface WorkflowEventLogFailure {
  eventType: string;
  stepIndex: number;
  step?: string;
  error?: string;
}

/** Bounded, redacted, structured account of why a workflow failed. */
export interface WorkflowFailureSummary {
  workflow?: string;
  terminalStatus?: string;
  terminalReason?: string;
  validationAttempts: WorkflowValidationAttempt[];
  eventLogFailures: WorkflowEventLogFailure[];
  /** True when attempts, errors, or event-log rows were dropped to stay bounded. */
  truncated: boolean;
}
