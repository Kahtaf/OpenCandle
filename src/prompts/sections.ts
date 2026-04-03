/** A named, budgeted section of the system prompt. */
export interface PromptSection {
  name: string;
  content: string;
  characterBudget: number;
}

/** Truncation marker appended when content exceeds budget. */
const TRUNCATION_MARKER = "\n[...truncated]";

/** Truncate content to fit within budget, preserving whole lines where possible. */
export function truncateTobudget(content: string, budget: number): string {
  if (content.length <= budget) return content;

  const effective = budget - TRUNCATION_MARKER.length;
  if (effective <= 0) return TRUNCATION_MARKER.trim();

  // Try to cut at the last newline before the budget
  const lastNewline = content.lastIndexOf("\n", effective);
  const cutPoint = lastNewline > 0 ? lastNewline : effective;
  return content.slice(0, cutPoint) + TRUNCATION_MARKER;
}

/** Standard section names in assembly order. */
export const SECTION_ORDER = [
  "base-role",
  "safety-rules",
  "tool-catalog",
  "workflow-instructions",
  "memory-context",
  "provider-status",
  "output-format",
] as const;

export type SectionName = typeof SECTION_ORDER[number];

/** Default character budgets per section. */
export const DEFAULT_BUDGETS: Record<SectionName, number> = {
  "base-role": 1500,
  "safety-rules": 2000,
  "tool-catalog": 3000,
  "workflow-instructions": 3000,
  "memory-context": 2000,
  "provider-status": 500,
  "output-format": 1500,
};
