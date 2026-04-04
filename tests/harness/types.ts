/** Structured trace types for the agent test harness. */

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
  isError: boolean;
  durationMs: number;
}

export interface TurnTrace {
  toolCalls: ToolCallTrace[];
  text: string;
}

export interface InteractionTrace {
  question: string;
  method: "select" | "text" | "confirm";
  options?: string[];
  answer: string | null;
}

export interface AgentTrace {
  prompt: string;
  turns: TurnTrace[];
  interactions: InteractionTrace[];
  finalText: string;
  toolSequence: string[];
  durationMs: number;
}
