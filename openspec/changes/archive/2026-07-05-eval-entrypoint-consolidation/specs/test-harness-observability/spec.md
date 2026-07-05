## RENAMED Requirements

- FROM: `### Requirement: Manual-Run Harness Captures OpenCandle Custom Entries`
- TO: `### Requirement: Harness Runners Capture OpenCandle Custom Entries`

## MODIFIED Requirements

### Requirement: Harness Runners Capture OpenCandle Custom Entries

The harness runners — the in-process runner (`tests/harness/opencandle-runner.ts`) and the IPC harness (`tests/harness/cli.ts`) — SHALL capture every session custom entry whose `customType` begins with `opencandle-` into the emitted trace under the top-level `customEntries` field. The capture SHALL occur after the agent has settled (after the harness's settle grace elapses) and before the trace is written. The implementation SHALL read entries from the session manager the harness already holds — no new Pi event subscription or agent API is required. The legacy single-prompt runner (`tests/harness/manual-run.ts`) is removed; no third capture path may be reintroduced.

#### Scenario: Router entry appears in the trace

- **WHEN** the agent handles a turn in LLM router mode that produces an `opencandle-router` custom entry (appended by the extension as `pi.appendEntry("opencandle-router", { output })`)
- **THEN** the trace's `customEntries` contains an entry with `customType === "opencandle-router"` whose `data.output` field equals the router output JSON verbatim

#### Scenario: Disclaimer entries appear once per final assistant turn

- **WHEN** the agent produces a final assistant response and the extension writes an `opencandle-disclaimer` custom entry
- **THEN** the trace's `customEntries` contains a matching `opencandle-disclaimer` entry for that turn; multi-step workflows may produce multiple such entries, one per final assistant turn

#### Scenario: Workflow dispatch entries appear in the trace

- **WHEN** the extension writes an `opencandle-workflow` entry on workflow dispatch
- **THEN** the trace's `customEntries` contains the matching `opencandle-workflow` entry preserving its `{workflow, entities, resolved}` payload

#### Scenario: Turn-gap entries appear when soft-degradation accumulates

- **WHEN** the extension flushes an `opencandle-turn-gap` entry at `turn_end` after one or more soft-degraded tool results during the turn
- **THEN** the trace's `customEntries` contains the matching `opencandle-turn-gap` entry with its `annotation` payload

#### Scenario: Non-opencandle custom entries excluded

- **WHEN** a third-party extension writes a custom entry with a prefix other than `opencandle-`
- **THEN** that entry SHALL NOT appear in the trace's `customEntries`

#### Scenario: Wildcard covers future entry types

- **WHEN** a new `opencandle-*` custom entry type is added in a later change (e.g., `opencandle-foo`)
- **THEN** the harness captures it without any further harness edits

### Requirement: Captured Entry Shape

Each entry in a harness trace's `customEntries` SHALL include at minimum the fields `customType: string`, `data: unknown` (the payload passed to `pi.appendEntry`), and `timestamp: string` (the `timestamp` field from the underlying `SessionEntry`). Emission order SHALL match the session-append order. This applies to every harness trace surface (the in-process runner's returned trace and the IPC harness's written trace file).

#### Scenario: Entry shape includes customType, data, and timestamp

- **WHEN** a custom entry is captured
- **THEN** the trace entry has the three required fields with types matching the SessionEntry's source data

#### Scenario: Entry order matches append order

- **WHEN** multiple `opencandle-*` entries are appended during a run
- **THEN** they appear in the trace's `customEntries` in the order they were written to the session
