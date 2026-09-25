import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTrace, TerminalErrorCategory, TerminalStopReason } from "./types.js";

/** All live eval entry points share this boundary, before answer scoring. */
export function assertSessionCompleted(trace: AgentTrace): void {
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
    | `terminal_${TerminalStopReason}`,
): never {
  const outcome = trace.terminalOutcome;
  // Persist only closed metadata: no prompt, answer, provider error, tool args,
  // or credentials. The failed attempt remains diagnosable even though callers
  // correctly never pass it to their answer scorers.
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
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  throw new Error(`OpenCandle session did not complete: ${reason}. Diagnostic: ${path}`);
}
