import type Database from "better-sqlite3";

/** All workflow event types. */
export type WorkflowEventType =
  | "workflow_started"
  | "slot_resolved"
  | "clarification_asked"
  | "clarification_answered"
  | "step_started"
  | "step_completed"
  | "step_failed"
  | "step_skipped"
  | "tool_called"
  | "tool_failed"
  | "validation_passed"
  | "validation_failed"
  | "workflow_completed"
  | "workflow_cancelled";

/** A persisted workflow event row. */
export interface WorkflowEvent {
  id: number;
  runId: string;
  stepIndex: number;
  eventType: WorkflowEventType;
  payloadJson: string | null;
  timestamp: string;
}

/** Append-only workflow event logger backed by SQLite. */
export class WorkflowEventLogger {
  constructor(private readonly db: Database.Database) {}

  /** Append a workflow event. */
  log(
    runId: string,
    stepIndex: number,
    eventType: WorkflowEventType,
    payload?: Record<string, unknown>,
  ): void {
    const now = new Date().toISOString();
    const payloadJson = payload ? JSON.stringify(payload) : null;
    this.db
      .prepare(
        `INSERT INTO workflow_events (run_id, step_index, event_type, payload_json, timestamp)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(runId, stepIndex, eventType, payloadJson, now);
  }

  /** Query all events for a given run ID, ordered by timestamp. */
  getEventsByRunId(runId: string): WorkflowEvent[] {
    const rows = this.db
      .prepare(
        "SELECT id, run_id, step_index, event_type, payload_json, timestamp FROM workflow_events WHERE run_id = ? ORDER BY id",
      )
      .all(runId) as Array<{
        id: number;
        run_id: string;
        step_index: number;
        event_type: string;
        payload_json: string | null;
        timestamp: string;
      }>;

    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      stepIndex: r.step_index,
      eventType: r.event_type as WorkflowEventType,
      payloadJson: r.payload_json,
      timestamp: r.timestamp,
    }));
  }
}
