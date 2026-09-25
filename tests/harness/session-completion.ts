import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTrace, TerminalErrorCategory, TerminalStopReason } from "./types.js";
import { summarizeWorkflowFailure } from "./workflow-failure-summary.js";

/** All live eval entry points share this boundary, before answer scoring. */
export function assertSessionCompleted(trace: AgentTrace): void {
  if (
    trace.customEntries?.some(
      (entry) =>
        entry.customType === "opencandle-workflow-complete" &&
        typeof entry.data === "object" &&
        entry.data !== null &&
        "status" in entry.data &&
        entry.data.status === "failed",
    )
  ) {
    failSessionCompletion(trace, "workflow_failed");
  }
  const outcome = trace.terminalOutcome;
  const reason = !outcome
    ? "missing_terminal_outcome"
    : outcome.errorPresent
      ? (outcome.errorCategory ?? "terminal_error")
      : outcome.stopReason !== "stop"
        ? (`terminal_${outcome.stopReason}` as const)
        : outcome.textEmpty || !trace.finalText.trim()
          ? "empty_answer"
          : undefined;
  if (!reason) return;

  failSessionCompletion(trace, reason);
}

export function failSessionCompletion(
  trace: AgentTrace,
  reason:
    | TerminalErrorCategory
    | "missing_terminal_outcome"
    | "terminal_error"
    | "empty_answer"
    | "workflow_failed"
    | `terminal_${TerminalStopReason}`,
): never {
  const outcome = trace.terminalOutcome;
  const workflowFailure =
    reason === "workflow_failed"
      ? (trace.workflowFailure ?? summarizeWorkflowFailure({ customEntries: trace.customEntries }))
      : undefined;
  // Persist only closed metadata: no prompt, answer, provider error, tool args,
  // or credentials (workflow validation errors are redacted and truncated).
  // The failed attempt remains diagnosable even though callers correctly never
  // pass it to their answer scorers.
  const directory = join(process.cwd(), "validation-output", "eval-diagnostics");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `session-completion-${Date.now()}-${randomUUID()}.json`);
  writeFileSync(
    path,
    `${JSON.stringify(
      {
        reason,
        terminalOutcome: outcome ?? null,
        retryEvents: trace.retryEvents ?? [],
        // Why the workflow failed: bounded, redacted validation errors per
        // attempt and event-log step failures. Never raw entries or answers.
        ...(workflowFailure === undefined ? {} : { workflowFailure }),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  throw new Error(`OpenCandle session did not complete: ${reason}. Diagnostic: ${path}`);
}
