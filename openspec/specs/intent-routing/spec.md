## Purpose
Intent routing classifies each user turn into the appropriate workflow or agent-task path while preserving extracted entities, slots, provenance, and observability.
## Requirements
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

Every canonical router output SHALL carry a `routeKind` field with exactly one of: `"workflow_dispatch"`, `"agent_task"`, `"clarification"`, or `"pass_through"`. The legacy `route` field MAY be derived for compatibility while migration is in progress, but implementation code SHALL treat `routeKind` as the canonical route decision.

`workflow_dispatch` SHALL mean a known OpenCandle workflow should run. `agent_task` SHALL mean the main agent should answer using route-scoped tools and context. `clarification` SHALL mean required information is missing and must be collected before analysis. `pass_through` SHALL mean the request is outside OpenCandle's finance task surface and must not receive finance tool bundles.

#### Scenario: Clearly-identifiable workflow query routes to workflow dispatch

- **WHEN** the user asks "invest $50k diversified"
- **THEN** `routeKind` is `"workflow_dispatch"` and `workflow` is `"portfolio_builder"`

#### Scenario: Outside-taxonomy finance query routes to agent task

- **WHEN** the user asks "Give me entry levels on ASTS for a 6 month horizon" and no workflow matches
- **THEN** `routeKind` is `"agent_task"` and `entities` are populated (`{symbols: ["ASTS"], timeHorizon: "6mo"}`)

#### Scenario: Simple data-fetch query routes to agent task

- **WHEN** the user asks "AAPL quote"
- **THEN** `routeKind` is `"agent_task"` and the main agent handles the tool call via its own tool loop

#### Scenario: Missing required data routes to clarification

- **WHEN** the user asks "build me an options setup" without a symbol and no reliable symbol is available from memory
- **THEN** `routeKind` is `"clarification"` and `missing_required` includes `"symbol"`

#### Scenario: Non-finance request routes to pass through

- **WHEN** the user asks "write a haiku about rain"
- **THEN** `routeKind` is `"pass_through"` and no finance tool bundle is selected

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

When the router identifies required slots that are not filled from the current turn, trusted memory, or defaults, it SHALL emit `routeKind: "clarification"` with those slot names in `missing_required: string[]`. The router SHALL NOT directly ask the user itself; the main agent or session layer SHALL use the existing `ask_user` AgentTool or equivalent interaction surface to collect the missing values.

#### Scenario: Missing required slot becomes clarification route

- **WHEN** the user asks "build me an options setup" without a symbol
- **THEN** router returns `routeKind: "clarification"`, with `missing_required: ["symbol"]`
- **AND** the selected tool bundle includes `ask_user`

#### Scenario: Main agent handles clarification through ask_user

- **WHEN** `routeKind` is `"clarification"` and `missing_required` is non-empty
- **THEN** the main agent calls `ask_user` during its normal tool loop to collect missing values before committing to financial analysis

#### Scenario: Reliable memory can avoid clarification

- **WHEN** the user asks "what about at $500?" and the prior turn establishes the symbol as NVDA
- **THEN** router does not emit `routeKind: "clarification"` for the symbol slot
- **AND** the symbol slot records the prior-turn source

### Requirement: Fallback Playbook Injection

When `routeKind` is `"agent_task"`, the main-agent system prompt SHALL include the agent-task playbook in addition to the universal analyst stance (defined in `analyst-stance`). The playbook SHALL instruct the agent to use route-scoped tools, anchor on the resolved entities/slots, and commit to an answer with risks clearly identified. It MUST NOT contain refusal or hedging language for in-scope finance questions.

When `routeKind` is `"pass_through"`, the prompt SHALL omit finance tool instructions and SHALL answer without invoking finance tools unless the user clarifies into an in-scope finance task.

#### Scenario: Agent task route gets the agent-task playbook

- **WHEN** router returns `routeKind: "agent_task"` with populated entities
- **THEN** the assembled prompt contains the agent-task playbook with tool-first, commit-with-reasoning instructions

#### Scenario: Agent task route receives the universal analyst stance

- **WHEN** router returns `routeKind: "agent_task"`
- **THEN** the assembled prompt still contains the universal analyst stance from `analyst-stance`

#### Scenario: Pass-through omits finance playbook

- **WHEN** router returns `routeKind: "pass_through"`
- **THEN** the assembled prompt does not include finance tool-use instructions

### Requirement: Every Turn Recorded with Matching turn_type

Every user turn SHALL be recorded in `workflow_runs` or the current turn trace store with a populated route type. The recorded route type SHALL equal the router's canonical `routeKind` value verbatim. During migration, legacy fields MAY also be written for compatibility, but the canonical stored value SHALL be `routeKind`.

#### Scenario: Workflow dispatch turn recorded

- **WHEN** router returns `routeKind: "workflow_dispatch"` and a workflow executes
- **THEN** a row or trace entry is inserted with route type `"workflow_dispatch"` and `workflow_type` set to the workflow name

#### Scenario: Agent task turn recorded

- **WHEN** router returns `routeKind: "agent_task"`
- **THEN** a row or trace entry is inserted with route type `"agent_task"` and `workflow_type = "agent_task"` or a documented sentinel value satisfying storage constraints

#### Scenario: Clarification turn recorded

- **WHEN** router returns `routeKind: "clarification"`
- **THEN** a row or trace entry is inserted with route type `"clarification"` and `missing_required` preserved in trace metadata

#### Scenario: Legacy rows are treated through adapter

- **WHEN** a legacy row containing `turn_type = "workflow"` or `turn_type = "fallback"` is read after migration
- **THEN** the adapter maps it to the matching compatible route category without data loss

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

The Assumptions block SHALL be rendered from resolved turn context slots and source provenance by a single shared renderer and included in the main-agent prompt for route kinds that perform finance analysis (`workflow_dispatch` and `agent_task`). Per-workflow Assumptions rendering via `buildDisclosureBlock` SHALL be consolidated into or replaced by this shared renderer.

#### Scenario: Workflow dispatch route renders Assumptions block

- **WHEN** `routeKind` is `"workflow_dispatch"`
- **THEN** the prompt contains an Assumptions block listing each slot with its source, using the labels "User-specified" / "From saved preferences" / "Defaults" / "From prior context" as applicable

#### Scenario: Agent task route renders Assumptions block

- **WHEN** `routeKind` is `"agent_task"` with populated slots
- **THEN** the prompt contains an Assumptions block using the same shared renderer and the same source labels

#### Scenario: Clarification route highlights missing slots

- **WHEN** `routeKind` is `"clarification"` with populated `missing_required`
- **THEN** the prompt contains the missing slots the agent must collect before analysis

### Requirement: Additive Schema Migration

The v2 → v3 schema migration SHALL be additive (`ALTER TABLE workflow_runs ADD COLUMN turn_type TEXT NOT NULL DEFAULT 'workflow'`) and SHALL preserve all existing rows in `workflow_runs`, `user_preferences`, and `recommendations`. The existing `resetSchema`-on-version-mismatch path SHALL be replaced with a real additive migration for this version bump.

#### Scenario: Migration preserves data

- **WHEN** a v2 database containing existing rows is upgraded to v3
- **THEN** all rows in `workflow_runs`, `user_preferences`, and `recommendations` remain present after migration, and the `turn_type` column exists on `workflow_runs` with default `"workflow"` applied to legacy rows

#### Scenario: Migration populates turn_type on legacy rows

- **WHEN** a legacy row (pre-v3) is read after migration
- **THEN** `turn_type` is `"workflow"` (via the column default)

### Requirement: Resolved Turn Context Carries Planning Identifiers

The resolved turn context SHALL carry planning identifiers for planning version, task family, commitment mode, policy card, evidence plan, answer contract, structured checks, workspace placeholders, and capability gaps while preserving the existing route kind, workflow, entity, slot, tool-bundle, memory, and diagnostics fields.

#### Scenario: Planning identifiers available to prompt assembly

- **WHEN** a routed finance turn reaches prompt assembly
- **THEN** prompt assembly receives the task family, commitment mode, policy card identifier, evidence plan identifier, answer contract identifier, structured-check identifiers, optional workspace/artifact placeholder identifiers, and capability-gap identifiers through resolved turn context

#### Scenario: Existing routing behavior is preserved

- **WHEN** planning identifiers are added to resolved turn context
- **THEN** existing route kind, workflow dispatch, clarification, pass-through, legacy route compatibility, tool bundle selection, and slot provenance behavior continue to work

### Requirement: Planning Selection Uses Manifest Validation

Planning selections SHALL be validated against a static manifest that maps route kinds, workflows, task families, policy cards, evidence plans, answer contracts, structured checks, and tool bundles. Unsupported combinations SHALL be corrected or diagnosed deterministically.

#### Scenario: Unsupported task family corrected

- **WHEN** the router or planner proposes a task family not allowed for the resolved route/workflow
- **THEN** deterministic post-processing corrects the task family to a manifest-supported fallback or emits a planning diagnostic

#### Scenario: Tool bundle remains coarse scope

- **WHEN** a task family selects an evidence plan
- **THEN** the selected tool bundles remain the broad allowed capability scope
- **AND** the evidence plan defines required and optional evidence within that scope

#### Scenario: Deterministic planner owns final V1 selection

- **WHEN** the router suggests task-family or planning identifiers
- **THEN** deterministic planning validates, corrects, or replaces those suggestions before prompt assembly
- **AND** the router does not become the authoritative source for long scenario-specific behavior

#### Scenario: Existing deterministic corrections remain authoritative

- **WHEN** existing router logic corrects or recovers route kind, workflow, entity, slot, or active tool-bundle behavior
- **THEN** the planner receives the corrected resolved turn context
- **AND** it does not override that correction unless a parity-ledger entry explicitly permits the changed behavior

#### Scenario: Issue 22 router boundaries are preserved

- **WHEN** the default router mode uses the LLM router
- **THEN** deterministic routing remains safety-net, enrichment, validation, correction, or explicit rules-mode infrastructure
- **AND** planning runs after that boundary rather than creating another competing primary router

### Requirement: Router Prompt Does Not Become the Planning Super Prompt

The router SHALL remain a low-agency classifier/planner. It SHALL NOT carry scenario-specific answer instructions that belong in policy cards, evidence plans, answer contracts, structured checks, or tools.

#### Scenario: Router classifies but does not synthesize

- **WHEN** the router processes a turn
- **THEN** it emits route, entity, slot, task-family, and planning identifiers
- **AND** it does not include long final-answer instructions for every possible scenario

#### Scenario: Scenario guidance lives outside router prompt

- **WHEN** a new scenario-specific behavior is needed
- **THEN** the behavior is added to a policy card, evidence plan, answer contract, structured check, or tool capability unless it genuinely changes routing classification

### Requirement: Followup Routing Preserves Planning Context

The routing layer SHALL expose enough prior-turn context for the planner to determine whether a followup should preserve, replace, refresh, or clarify the previous task family, commitment mode, entities, and evidence.

#### Scenario: Followup swaps entity

- **WHEN** the user asks a followup that replaces one symbol, fund, account type, or constraint
- **THEN** resolved turn context includes prior-turn provenance and the replacement value needed for planning

#### Scenario: Followup cannot be resolved

- **WHEN** the prior reference is ambiguous or stale enough to affect the answer
- **THEN** resolved turn context includes a missing-context diagnostic suitable for clarification

### Requirement: Route Capability Manifest

The system SHALL define a route capability manifest that is the source of truth for route kinds, supported workflows, required slots, allowed tool bundles, memory scopes, prompt playbooks, and legacy route mappings.

#### Scenario: Router prompt is generated from manifest

- **WHEN** route kinds or workflows are listed in the router prompt
- **THEN** they are derived from the route capability manifest rather than duplicated manually

#### Scenario: Post-processor validates against manifest

- **WHEN** the LLM router emits an unsupported workflow, slot, or tool bundle for a route kind
- **THEN** deterministic post-processing corrects or rejects that field according to the manifest and records a diagnostic

### Requirement: Deterministic Router as Post-Processor

When the LLM router is enabled, deterministic routing code SHALL NOT make the primary route decision. Deterministic code SHALL validate and normalize the LLM output, enforce manifest constraints, compute missing required slots, and produce diagnostics for any correction.

#### Scenario: LLM route remains primary

- **WHEN** `OPENCANDLE_ROUTER_MODE=llm` and the router emits valid `routeKind: "agent_task"`
- **THEN** deterministic code does not override it with a legacy keyword route

#### Scenario: Invalid route kind is corrected

- **WHEN** the LLM router emits an invalid route kind
- **THEN** post-processing applies the documented fallback correction and records a diagnostic explaining the correction

