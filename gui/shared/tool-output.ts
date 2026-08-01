import type { ToolOutput } from "./chat-events.js";

export function normalizeToolOutput(value: {
  content?: unknown;
  details?: unknown;
  isError?: boolean;
}): ToolOutput {
  const details = value.details;
  const source =
    typeof details === "object" && details !== null && "source" in details
      ? String((details as { source?: unknown }).source ?? "")
      : undefined;
  return {
    content: Array.isArray(value.content) ? (value.content as ToolOutput["content"]) : [],
    details,
    isError: value.isError,
    source,
  };
}

export function getToolOutcomeStatus(value: { details?: unknown } | undefined): string | undefined {
  const wrapped = value?.details;
  const details =
    typeof wrapped === "object" && wrapped !== null && "value" in wrapped
      ? (wrapped as { value?: unknown }).value
      : wrapped;
  return typeof details === "object" && details !== null && "status" in details
    ? String((details as { status?: unknown }).status ?? "") || undefined
    : undefined;
}

export function toolOutcomeNeedsInput(value: { details?: unknown } | undefined): boolean {
  const status = getToolOutcomeStatus(value);
  return status === "needs_selection" || status === "needs_currency" || status === "needs_lot_id";
}
