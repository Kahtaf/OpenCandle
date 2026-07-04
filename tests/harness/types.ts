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
 * openspec/changes/router-context-and-observability/design.md Decision 6. */
export interface CustomEntryTrace {
  customType: string;
  data: unknown;
  timestamp: string;
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
  /** OpenCandle extension-authored custom entries, in append order. */
  customEntries?: CustomEntryTrace[];
}
