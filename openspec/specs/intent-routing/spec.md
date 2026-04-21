## ADDED Requirements

### Requirement: Single LLM Router Call per Turn (Behind Rollout Flag)

When `OPENCANDLE_ROUTER_MODE=llm`, the system SHALL invoke a single LLM-based router call on every user turn before system-prompt assembly. The router SHALL emit a structured JSON output containing route classification, entities, slots with provenance, preference updates, and a `missing_required` list.

When `OPENCANDLE_ROUTER_MODE=rules` (the default during rollout), the system SHALL invoke the legacy `classifyIntent` and `extractPreferences` path unchanged.

#### Scenario: Router runs on every turn when flag is llm

- **WHEN** `OPENCANDLE_ROUTER_MODE=llm` is set and the user submits a turn through `pi.on("input")`
- **THEN** exactly one router LLM call is made before the main-agent prompt is assembled

#### Scenario: Rules path runs when flag is rules

- **WHEN** `OPENCANDLE_ROUTER_MODE=rules` is set (the default) and the user submits a turn
- **THEN** the legacy `classifyIntent` + `extractPreferences` path executes and the router is not invoked

#### Scenario: Router output is structured and validated

- **WHEN** the router returns a response
- **THEN** the response is parsed and validated against the defined JSON schema; on validation failure, one retry is attempted with error feedback; on persistent failure, the router emits a minimal fallback output (`route: "fallback"`, extracted symbols only, empty slots, empty preference_updates, empty missing_required)

### Requirement: Two-Value Route Categorization

Every router output SHALL carry a `route` field with exactly one of: `"workflow"` or `"fallback"`. Any other value is invalid.

#### Scenario: Clearly-identifiable workflow query routes to workflow

- **WHEN** the user asks "invest $50k diversified"
- **THEN** route is `"workflow"` and `workflow` is `"portfolio_builder"`

#### Scenario: Outside-taxonomy query routes to fallback

- **WHEN** the user asks "Give me entry levels on ASTS for a 6 month horizon" and no workflow matches
- **THEN** route is `"fallback"` and `entities` are populated (`{symbols: ["ASTS"], timeHorizon: "6mo"}`)

#### Scenario: Simple data-fetch query routes to fallback (not to a separate direct_tool route)

- **WHEN** the user asks "AAPL quote"
- **THEN** route is `"fallback"` (not `"direct_tool"`) and the main agent handles the tool call via its own tool loop — the router does NOT execute tools directly

### Requirement: Per-Slot Source Provenance

Every slot in the router output SHALL include a `source` field with one of: `"user"` (extracted from current turn), `"preference"` (retrieved from investor_profile), or `"default"` (applied as a fallback). These values match the existing `SlotSource` type in `src/routing/types.ts`.

#### Scenario: Slot sourced from current turn

- **WHEN** the user says "aggressive 6-month view" and the router extracts `risk_profile = "aggressive"` from the utterance
- **THEN** `slots.risk_profile.source` is `"user"`

#### Scenario: Slot sourced from saved preference

- **WHEN** the user's investor_profile already contains `risk_profile = "aggressive"` and the current turn does not mention risk
- **THEN** `slots.risk_profile.source` is `"preference"`

#### Scenario: Slot sourced from default

- **WHEN** neither the current turn nor memory provides a value and the workflow applies a default
- **THEN** `slots.<name>.source` is `"default"`

### Requirement: High-Confidence-Only Preference Writes

The system SHALL persist `preference_updates` entries only when `confidence === "high"`. Entries with `"medium"` or `"low"` confidence SHALL NOT be written to `user_preferences` storage but MAY be logged to an observability entry (e.g., `opencandle-router-prefs-dropped`).

#### Scenario: High-confidence preference persists

- **WHEN** the router emits `preference_updates: [{key: "risk_profile", value: "aggressive", confidence: "high", source: "inferred"}]`
- **THEN** the value is upserted into `user_preferences` with `source: "inferred"`

#### Scenario: Medium-confidence preference does not persist

- **WHEN** the router emits a preference_update with `confidence: "medium"`
- **THEN** no write occurs to `user_preferences` for that update

### Requirement: Missing-Required Surfacing (Not a Separate Clarifier Route)

When the router identifies required slots that are not filled from the current turn, memory, or defaults, it SHALL emit those slot names in `missing_required: string[]`. The router SHALL NOT pre-empt the main agent with a clarifier UI prompt; clarification is handled by the main agent via its existing `ask_user` AgentTool.

#### Scenario: Missing required slot is surfaced, not clarified pre-LLM

- **WHEN** the user asks "build me an options setup" without a symbol
- **THEN** router returns `route: "workflow"` (or `"fallback"` if confidence is low), with `missing_required: ["symbol"]`
- **AND** the main agent prompt includes a hint that `symbol` is missing and the agent should call `ask_user` to collect it before committing

#### Scenario: Main agent handles clarification through ask_user

- **WHEN** `missing_required` is non-empty and the main agent runs
- **THEN** the main agent calls `ask_user` during its normal tool loop to collect missing values; the extension does NOT drive a pre-LLM clarifier state machine

### Requirement: Fallback Playbook Injection

When `route` is `"fallback"`, the main-agent system prompt SHALL include a fallback playbook section in addition to the universal analyst stance (defined in `analyst-stance`). The fallback playbook SHALL instruct the agent to use available tools, anchor on the router-supplied entities/slots, and commit to an answer — it MUST NOT contain refusal or hedging language.

#### Scenario: Fallback route gets the fallback playbook

- **WHEN** router returns `route: "fallback"` with populated entities
- **THEN** the assembled prompt contains the fallback playbook section with tool-first, commit-with-reasoning instructions

#### Scenario: Fallback route receives the universal analyst stance

- **WHEN** router returns `route: "fallback"`
- **THEN** the assembled prompt still contains the universal analyst stance from `analyst-stance`

### Requirement: Every Turn Recorded with Matching turn_type

Every user turn SHALL be recorded in `workflow_runs` with a populated `turn_type` column. The `turn_type` value SHALL equal the router's `route` value verbatim (either `"workflow"` or `"fallback"`).

#### Scenario: Workflow turn recorded

- **WHEN** router returns `route: "workflow"` and a workflow executes
- **THEN** a row is inserted into `workflow_runs` with `turn_type = "workflow"` and `workflow_type` set to the workflow name

#### Scenario: Fallback turn recorded

- **WHEN** router returns `route: "fallback"`
- **THEN** a row is inserted into `workflow_runs` with `turn_type = "fallback"` and `workflow_type = "fallback"` (sentinel value satisfying the NOT NULL constraint)

#### Scenario: Legacy rows are treated as workflow turns

- **WHEN** the migration runs against an existing v2 database
- **THEN** existing rows are populated with `turn_type = "workflow"` via the column default, preserving all data

### Requirement: No Router Tool Access in v1

The router LLM call SHALL NOT have access to any registered AgentTools in v1. Classification, entity extraction, and preference capture SHALL operate on text alone.

#### Scenario: Router does not call any tool

- **WHEN** the router processes any turn
- **THEN** the router does not call `get_stock_quote`, `search_ticker`, `get_option_chain`, `normalize_symbol`, or any other tool, whether registered or not

### Requirement: Prior-Turn Context Window

The router SHALL receive the last 5 user/assistant turns of conversation history, the current investor_profile snapshot, and the 3 most recent `workflow_runs` summaries as part of its input context.

#### Scenario: Context-dependent query uses prior turns

- **WHEN** the previous turn was about NVDA and the current turn is "what about at $500?"
- **THEN** the router receives the NVDA prior-turn in its context and can disambiguate the pronoun reference

### Requirement: Shared Assumptions-Block Rendering

The Assumptions block SHALL be rendered from router output (`slots[].source`) by a single shared renderer and included in the main-agent prompt for both route types (`workflow`, `fallback`). Per-workflow Assumptions rendering via `buildDisclosureBlock` SHALL be consolidated into or replaced by this shared renderer.

#### Scenario: Workflow route renders Assumptions block

- **WHEN** route is `"workflow"`
- **THEN** the prompt contains an Assumptions block listing each slot with its source, using the labels "User-specified" / "From saved preferences" / "Defaults" (matching the existing `buildDisclosureBlock` convention)

#### Scenario: Fallback route renders Assumptions block

- **WHEN** route is `"fallback"` with populated slots
- **THEN** the prompt contains an Assumptions block using the same shared renderer and the same labels

### Requirement: Additive Schema Migration

The v2 → v3 schema migration SHALL be additive (`ALTER TABLE workflow_runs ADD COLUMN turn_type TEXT NOT NULL DEFAULT 'workflow'`) and SHALL preserve all existing rows in `workflow_runs`, `user_preferences`, and `recommendations`. The existing `resetSchema`-on-version-mismatch path SHALL be replaced with a real additive migration for this version bump.

#### Scenario: Migration preserves data

- **WHEN** a v2 database containing existing rows is upgraded to v3
- **THEN** all rows in `workflow_runs`, `user_preferences`, and `recommendations` remain present after migration, and the `turn_type` column exists on `workflow_runs` with default `"workflow"` applied to legacy rows

#### Scenario: Migration populates turn_type on legacy rows

- **WHEN** a legacy row (pre-v3) is read after migration
- **THEN** `turn_type` is `"workflow"` (via the column default)
