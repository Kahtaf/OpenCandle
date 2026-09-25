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
  /** OpenCandle extension-authored custom entries, in append order. */
  customEntries?: CustomEntryTrace[];
}
