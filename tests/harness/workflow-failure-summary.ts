import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { redactDiagnosticString } from "../evals/diagnostic-redaction.js";
import type {
  CustomEntryTrace,
  WorkflowEventLogFailure,
  WorkflowFailureSummary,
  WorkflowValidationAttempt,
} from "./types.js";

/** Most validation attempts / event-log failures kept in one summary. */
export const MAX_WORKFLOW_FAILURE_EVENTS = 12;
/** Most validation errors kept per attempt. */
export const MAX_WORKFLOW_FAILURE_ERRORS_PER_ATTEMPT = 5;
/** Longest single error message kept, after redaction. */
export const MAX_WORKFLOW_FAILURE_ERROR_CHARS = 400;
const MAX_LABEL_CHARS = 80;

/** Durable workflow event-log rows that explain a failure. */
const EVENT_LOG_FAILURE_TYPES = [
  "step_failed",
  "tool_failed",
  "validation_failed",
  "workflow_cancelled",
] as const;

/** One raw row from the `workflow_events` table (payload not yet parsed). */
export interface WorkflowEventLogRow {
  runId: string;
  stepIndex: number;
  eventType: string;
  payloadJson: string | null;
}

/**
 * Read the failure rows of the durable workflow event log (`state.db` in the
 * harness home). The harness deletes that home after a run, so this must run
 * first. Never throws: a missing database or table just yields no rows.
 */
export function readWorkflowFailureEvents(stateDbPath: string): WorkflowEventLogRow[] {
  if (!existsSync(stateDbPath)) return [];
  let db: Database.Database | undefined;
  try {
    db = new Database(stateDbPath, { readonly: true, fileMustExist: true });
    const placeholders = EVENT_LOG_FAILURE_TYPES.map(() => "?").join(", ");
    const rows = db
      .prepare(
        `SELECT run_id, step_index, event_type, payload_json FROM workflow_events
         WHERE event_type IN (${placeholders}) ORDER BY id LIMIT ?`,
      )
      .all(...EVENT_LOG_FAILURE_TYPES, MAX_WORKFLOW_FAILURE_EVENTS + 1) as Array<{
      run_id: string;
      step_index: number;
      event_type: string;
      payload_json: string | null;
    }>;
    return rows.map((row) => ({
      runId: row.run_id,
      stepIndex: row.step_index,
      eventType: row.event_type,
      payloadJson: row.payload_json,
    }));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function label(value: unknown): string | undefined {
  return typeof value === "string" ? redactDiagnosticString(value, MAX_LABEL_CHARS) : undefined;
}

function errorText(value: unknown): string {
  return redactDiagnosticString(
    typeof value === "string" ? value : (JSON.stringify(value) ?? String(value)),
    MAX_WORKFLOW_FAILURE_ERROR_CHARS,
  );
}

function parsePayload(payloadJson: string | null): Record<string, unknown> {
  if (!payloadJson) return {};
  try {
    const parsed: unknown = JSON.parse(payloadJson);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Bounded, redacted, structured account of WHY a workflow failed, built from
 * the session's `opencandle-workflow*` entries plus the durable event log.
 *
 * Returns `undefined` unless the workflow reached a failed terminal status or
 * the event log recorded a step failure, so passing runs are unchanged (a
 * validation failure that the repair fixed is not a failure). Never includes
 * raw entries, prompts, answers, or tool payloads.
 */
export function summarizeWorkflowFailure(input: {
  customEntries?: readonly CustomEntryTrace[];
  eventLog?: readonly WorkflowEventLogRow[];
}): WorkflowFailureSummary | undefined {
  const entries = input.customEntries ?? [];
  const eventLog = input.eventLog ?? [];
  const lastData = (customType: string): Record<string, unknown> | undefined => {
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry?.customType === customType && isRecord(entry.data)) return entry.data;
    }
    return undefined;
  };

  const complete = lastData("opencandle-workflow-complete");
  const terminalStatus = label(complete?.status);
  const hasStepFailure = eventLog.some((row) => row.eventType === "step_failed");
  if (terminalStatus !== "failed" && !hasStepFailure) return undefined;

  let truncated = false;
  const attemptsByStep = new Map<string, number>();
  const validationAttempts: WorkflowValidationAttempt[] = [];
  for (const entry of entries) {
    if (entry.customType !== "opencandle-workflow-event" || !isRecord(entry.data)) continue;
    if (entry.data.eventType !== "output_validation_failed") continue;
    const step = label(entry.data.stepType) ?? "unknown";
    const attempt = (attemptsByStep.get(step) ?? 0) + 1;
    attemptsByStep.set(step, attempt);
    if (validationAttempts.length >= MAX_WORKFLOW_FAILURE_EVENTS) {
      truncated = true;
      continue;
    }
    const rawErrors = Array.isArray(entry.data.errors) ? entry.data.errors : [];
    if (rawErrors.length > MAX_WORKFLOW_FAILURE_ERRORS_PER_ATTEMPT) truncated = true;
    validationAttempts.push({
      step,
      attempt,
      repairAttempted: entry.data.repairAttempted === true,
      errors: rawErrors.slice(0, MAX_WORKFLOW_FAILURE_ERRORS_PER_ATTEMPT).map(errorText),
    });
  }

  const failureRows = eventLog.filter((row) =>
    (EVENT_LOG_FAILURE_TYPES as readonly string[]).includes(row.eventType),
  );
  if (failureRows.length > MAX_WORKFLOW_FAILURE_EVENTS) truncated = true;
  const eventLogFailures: WorkflowEventLogFailure[] = failureRows
    .slice(0, MAX_WORKFLOW_FAILURE_EVENTS)
    .map((row) => {
      const payload = parsePayload(row.payloadJson);
      const step = label(payload.stepType);
      const reason = payload.error ?? payload.reason;
      return {
        eventType: row.eventType,
        stepIndex: row.stepIndex,
        ...(step === undefined ? {} : { step }),
        ...(reason === undefined ? {} : { error: errorText(reason) }),
      };
    });

  const workflow = label(lastData("opencandle-workflow")?.workflow ?? complete?.workflow);
  const terminalReason = label(complete?.reason);
  return {
    ...(workflow === undefined ? {} : { workflow }),
    ...(terminalStatus === undefined ? {} : { terminalStatus }),
    ...(terminalReason === undefined ? {} : { terminalReason }),
    validationAttempts,
    eventLogFailures,
    truncated,
  };
}
