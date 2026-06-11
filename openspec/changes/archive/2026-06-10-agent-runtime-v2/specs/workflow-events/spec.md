## ADDED Requirements

### Requirement: Workflow events are persisted to SQLite
The runtime SHALL persist workflow events to a `workflow_events` table in the existing SQLite database. Each event row SHALL contain `run_id`, `step_index`, `event_type`, `payload_json`, and `timestamp`.

#### Scenario: Event is written on workflow start
- **WHEN** a workflow run begins
- **THEN** a `workflow_started` event is written with `run_id`, `step_index: 0`, and payload containing workflow type and resolved slots

#### Scenario: Event is written on step completion
- **WHEN** a workflow step completes successfully
- **THEN** a `step_completed` event is written with the step index and a summary of the step output

### Requirement: Event types cover the full workflow lifecycle
The system SHALL support these event types: `workflow_started`, `slot_resolved`, `clarification_asked`, `clarification_answered`, `step_started`, `step_completed`, `step_failed`, `step_skipped`, `tool_called`, `tool_failed`, `validation_passed`, `validation_failed`, `workflow_completed`, `workflow_cancelled`.

#### Scenario: Tool failure is logged
- **WHEN** a tool call within a workflow step fails
- **THEN** a `tool_failed` event is written with the tool name, error message, and provider in the payload

#### Scenario: Validation failure is logged
- **WHEN** deterministic validation finds a number mismatch
- **THEN** a `validation_failed` event is written with the validation failure details in the payload

### Requirement: Events are append-only
Events SHALL be insert-only — no updates or deletes to event rows. This ensures a complete audit trail of workflow execution.

#### Scenario: Events cannot be modified
- **WHEN** a workflow event has been written
- **THEN** the event row is immutable — only new events can be appended

### Requirement: Events are queryable by run ID
The storage layer SHALL support querying all events for a given `run_id`, ordered by timestamp. This enables reconstructing the full execution history of any workflow run.

#### Scenario: Query events for a completed run
- **WHEN** a developer queries events for run ID "run_abc123"
- **THEN** all events for that run are returned in chronological order, showing the complete execution trace

#### Scenario: Query events for a failed run
- **WHEN** a workflow run failed at the risk_review step
- **THEN** querying events shows `workflow_started`, `step_completed` for prior steps, `step_failed` for risk_review, and `workflow_cancelled` for remaining steps

### Requirement: Events are lightweight and local-only
Event logging SHALL be local to the SQLite database with no external telemetry, network calls, or third-party services. Event payloads SHALL be compact JSON — tool result data is summarized, not stored in full.

#### Scenario: Tool call event has compact payload
- **WHEN** a `tool_called` event is logged for `get_stock_quote`
- **THEN** the payload contains `{ tool: "get_stock_quote", args: { symbol: "AAPL" }, status: "ok" }` — not the full quote response data
