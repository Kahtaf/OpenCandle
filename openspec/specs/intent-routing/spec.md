## Purpose
Intent routing classifies each user turn into the appropriate workflow or agent-task path while preserving extracted entities, slots, provenance, and observability.
## Requirements
### Requirement: Route Kind Categorization

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

Every slot in the router output SHALL include a `source` field with one of: `"user"` (extracted from current turn), `"preference"` (retrieved from investor_profile), `"default"` (applied as a fallback), `"prior_context"` (carried from earlier conversation turns), or `"memory"` (retrieved from persisted memory outside the investor_profile preference path). These values match the existing `SlotSource` type in `src/routing/types.ts` and render as User-specified, From saved preferences, Defaults, From prior context, or From memory in Assumptions blocks.

#### Scenario: Slot sourced from current turn

- **WHEN** the user says "aggressive 6-month view" and the router extracts `risk_profile = "aggressive"` from the utterance
- **THEN** `slots.risk_profile.source` is `"user"`

#### Scenario: Slot sourced from saved preference

- **WHEN** the user's investor_profile already contains `risk_profile = "aggressive"` and the current turn does not mention risk
- **THEN** `slots.risk_profile.source` is `"preference"`

#### Scenario: Slot sourced from default

- **WHEN** neither the current turn nor memory provides a value and the workflow applies a default
- **THEN** `slots.<name>.source` is `"default"`

#### Scenario: Slot sourced from prior context

- **WHEN** the user says "what about at $500?" and the prior turn establishes the symbol as NVDA
- **THEN** `slots.symbol.source` is `"prior_context"`

#### Scenario: Slot sourced from memory

- **WHEN** persisted memory outside investor_profile provides a reliable slot value
- **THEN** `slots.<name>.source` is `"memory"`

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
- **AND** the symbol slot records `source: "prior_context"`

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

The router SHALL receive the last 5 user/assistant turns of conversation history, the current investor_profile snapshot, and the 3 most recent `workflow_runs` summaries as part of its input context. Prior turns SHALL be retrieved from the active session branch (Pi `ReadonlySessionManager.getBranch()`) at input-event time, filtered to `role === "user"` and `role === "assistant"` message entries with non-empty text content, ordered oldest-to-newest, and sliced to the 5 most recent. Tool-result messages and empty-text turns SHALL be excluded. When the session has fewer than 5 qualifying prior turns, the router SHALL receive the full available history; an empty window is only permitted when the session has no prior qualifying turns.

#### Scenario: Context-dependent query uses prior turns

- **WHEN** the previous turn was "tell me about NVDA" and the current turn is "what about at $500?"
- **THEN** the router's `RouterInputContext.priorTurns` contains the NVDA user turn (and any subsequent assistant text turn) and the emitted `RouterOutput.entities.symbols` contains `"NVDA"`

#### Scenario: Prior turns retrieved at input-event time reflect strictly prior state

- **WHEN** the `pi.on("input")` handler invokes the router
- **THEN** the branch read at that moment contains all prior user/assistant turns but NOT the current turn's text (Pi emits the input event before appending the user message)

#### Scenario: Tool-result and empty-text turns excluded

- **WHEN** the branch contains tool-result messages and an aborted assistant turn with no text content
- **THEN** those entries SHALL NOT appear in `priorTurns`; only user and assistant message entries with non-empty text are included

#### Scenario: Fewer than 5 prior turns

- **WHEN** the session has only 2 qualifying prior turns
- **THEN** `priorTurns` contains those 2 entries, not a padded or empty array

#### Scenario: No prior turns

- **WHEN** the session is fresh and has no prior user/assistant messages
- **THEN** `priorTurns` is an empty array and the router still produces a valid route for the current turn

#### Scenario: Compacted session branch

- **WHEN** the session branch contains a compaction summary entry (Pi `type === "compaction"`) between root and leaf
- **THEN** the `priorTurns` extraction SHALL skip compaction entries (and branch summary entries) rather than attempt to parse their summary text as message content; `priorTurns` MAY be shorter than 5 when the post-compaction message window is narrower than 5, and this is correct behavior — no synthesized messages are injected to pad the window

#### Scenario: Assistant turn with tool calls but no text

- **WHEN** an assistant message entry contains only tool-call content blocks and no text block
- **THEN** that entry contributes nothing to `priorTurns` (it is dropped by the empty-text filter), and the neighboring text-bearing turns retain their positions in the window

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

Deterministic routing code SHALL NOT make the primary route decision. Deterministic code SHALL validate and normalize the LLM output, enforce manifest constraints, compute missing required slots, and produce diagnostics for any correction. Deterministic safety nets — acronym disambiguation via `symbol-disambiguator`, symbol preflight and provider invalid-symbol handling, compare clarification aborts, router validation-failure recovery, and tool validation — SHALL remain active on LLM router output.

#### Scenario: LLM route remains primary

- **WHEN** the router emits valid `routeKind: "agent_task"`
- **THEN** deterministic code does not override it with a legacy keyword route

#### Scenario: Invalid route kind is corrected

- **WHEN** the LLM router emits an invalid route kind
- **THEN** post-processing applies the documented fallback correction and records a diagnostic explaining the correction

#### Scenario: Deterministic safety nets survive rules-router removal

- **WHEN** the legacy rules router is removed as a dispatch path
- **THEN** acronym disambiguation via `symbol-disambiguator`, workflow symbol preflight, provider/tool validation, compare clarification aborts, and router validation-failure recovery continue to run against LLM router output

### Requirement: Single LLM Router Call per Turn

The system SHALL invoke a single LLM-based router call on every user turn before system-prompt assembly. The router SHALL emit a structured JSON output containing route classification, entities, slots with provenance, preference updates, and a `missing_required` list. The LLM router is the default and only production routing path; no rules-mode primary dispatch exists.

#### Scenario: Router runs on every turn

- **WHEN** the user submits a turn through `pi.on("input")`
- **THEN** exactly one router LLM call is made before the main-agent prompt is assembled

#### Scenario: Unset router mode uses the LLM router

- **WHEN** `OPENCANDLE_ROUTER_MODE` is unset
- **THEN** OpenCandle routes input through the LLM router

#### Scenario: Explicit llm mode uses the LLM router

- **WHEN** `OPENCANDLE_ROUTER_MODE=llm` is set
- **THEN** OpenCandle routes input through the LLM router

#### Scenario: Rules mode is rejected with migration guidance

- **WHEN** `OPENCANDLE_ROUTER_MODE=rules` is set
- **THEN** config loading fails fast with an error explaining that the rules router was removed and the variable should be unset

#### Scenario: Router output is structured and validated

- **WHEN** the router returns a response
- **THEN** the response is parsed and validated against the defined JSON schema; on validation failure, one retry is attempted with error feedback; on persistent failure, the router emits a minimal fallback output (`route: "fallback"`, extracted symbols only, empty slots, empty preference_updates, empty missing_required)

### Requirement: Rules Router Removal Requires Acceptance Evidence

The legacy rules-router dispatch path SHALL only be removed after the live router eval has been run against the production model with the results recorded in the change, including a classification of every fixture failure. Failures SHALL be either benign model-choice differences (extra informational slots, richer workflow labels with the same route kind, internal diagnostics differences) or individually explained; unexplained route-kind regressions block the removal. The eval diff SHALL compare the routing contract (route kind, workflow, entities, slots, missing required, tool bundles, preference updates) and not internal correction diagnostics, which are model-recording-specific.

#### Scenario: Live eval evidence recorded before removal

- **WHEN** the change removing rules-mode dispatch is prepared
- **THEN** `npm run eval -- router-live` has been run with live credentials against the production model
- **AND** the run output is recorded in the change evidence

#### Scenario: Fixture failures classified

- **WHEN** the recorded live eval has non-exact fixtures
- **THEN** each failure is classified as benign model-choice difference, fixture/recording mismatch, or genuine route-quality gap with rationale

#### Scenario: Unexplained route-kind regression blocks removal

- **WHEN** the live eval shows a route-kind disagreement that is not explained and accepted in the evidence record
- **THEN** the rules-router removal does not land until the regression is fixed or the fixture is re-recorded with justification

### Requirement: Prior-Turn Shape

Each prior-turn entry SHALL be a `{ role: "user" | "assistant", text: string }` object. The `text` field SHALL contain the concatenated text content of the message. The router prompt renderer SHALL clip each turn's text to a fixed character limit and strip newlines to bound prompt growth. Assistant tool-call summaries SHALL NOT be included in v1.

#### Scenario: Assistant turn with mixed content blocks

- **WHEN** an assistant message contains a text block and a tool-call block
- **THEN** the prior-turn entry contains the text block's content only; the tool call is omitted

#### Scenario: Long text is clipped

- **WHEN** a prior user message exceeds the per-turn character limit
- **THEN** the router prompt renders a clipped version, preserving router-prompt size bounds

### Requirement: Prior-Turn Privacy and Forget Integration

The system SHALL document that conversational text in `priorTurns` is NOT governed by the structured-memory `NEVER_TRUST_FROM_MEMORY` guard and that priorTurns scrubbing is the responsibility of a future `/forget` command. The documentation SHALL name this as a known gap until `/forget` ships.

#### Scenario: Documentation declares the gap

- **WHEN** a contributor reads the router proposal, design, or router README
- **THEN** they find an explicit note that priorTurns is not filtered by the current memory privacy controls and that `/forget` is the designated follow-up primitive

#### Scenario: /forget (when implemented) scrubs priorTurns sources

- **WHEN** a future `/forget <topic>` command is implemented
- **THEN** its contract SHALL include removing or masking matching entries from the session branch or its priorTurns derivation so that subsequent router invocations do not see scrubbed content

### Requirement: Acronym Disambiguation Post-Filter

After LLM router output is parsed, the system SHALL apply an acronym disambiguation post-filter to `entities.symbols` that removes tokens belonging to a finance-acronym dictionary unless at least one positive ticker signal is present in the raw user input.

The dictionary SHALL include at minimum: IV, HV, ITM, OTM, ATM, IPO, SEC, FED, FOMC, IRS, ECB, BOE, BOJ, GDP, CPI, PPI, FX, NDA. `MA` SHALL NOT be blanket-dropped because it is the common Mastercard ticker; moving-average or M&A usage SHALL be handled with context-specific rules instead.

A positive ticker signal is defined as one of:
- The raw input contains `$<token>` (case-insensitive),
- The raw input contains a local phrase that marks that token as a ticker/stock/symbol, such as "IV ticker", "ticker IV", "IV stock", "symbol IV", or "stock IV",
- A future parser emits another explicit per-token ticker marker covered by tests.

Bare comma-list or "and"-list adjacency is not a positive ticker signal.

#### Scenario: Bare acronym with no signal is dropped

- **WHEN** the user says "Compare these assets: IV, ASTS" with no `$`-prefix and no local ticker phrase for IV
- **THEN** `entities.symbols === ["ASTS"]` and IV is dropped via the post-filter
- **AND** an `opencandle-symbol-dropped` custom entry is appended with `{ token: "IV", reason: "no positive ticker signal", source: <mode> }`

#### Scenario: Compare prompt clarifies when a drop leaves too few symbols

- **WHEN** the LLM router receives "Compare these assets: IV, ASTS"
- **AND** IV is dropped as an ambiguous finance acronym
- **THEN** OpenCandle SHALL NOT pass the raw prompt through to the main agent as a comparison request
- **AND** it SHALL append `opencandle-workflow-aborted` with reason `symbol-disambiguation-insufficient-symbols`
- **AND** the next agent turn SHALL receive clarification context instructing it to call `ask_user` before comparison tools

#### Scenario: Acronym with `$`-prefix is retained

- **WHEN** the user says "Get me a quote on $IV"
- **THEN** `entities.symbols === ["IV"]` (retained because `$IV` is a positive signal)

#### Scenario: Bare acronym in mixed list is dropped

- **WHEN** the user says "compare KO, IV, PEP"
- **THEN** `entities.symbols === ["KO","PEP"]`
- **AND** IV is dropped because list context alone is insufficient

#### Scenario: Acronym with local ticker phrase is retained

- **WHEN** the user says "compare KO, the IV ticker, and PEP"
- **THEN** `entities.symbols === ["KO","IV","PEP"]`

#### Scenario: Disambiguation runs after LLM router output

- **WHEN** the LLM router emits `entities.symbols: ["IV","ASTS"]` for input "Compare these assets: IV, ASTS"
- **THEN** the post-filter still removes IV before the output reaches the main agent
- **AND** the same drop logic and observability entries apply regardless of the model output shape

#### Scenario: Dropped symbols are not restored from slots

- **WHEN** the LLM router emits a dropped token in both `entities.symbols` and `slots.symbols`
- **THEN** OpenCandle SHALL remove the token from workflow dispatch symbols
- **AND** router slot merging SHALL NOT reintroduce a token already reported by `symbol_dropped`
- **AND** missing-required-slot checks SHALL use sanitized symbol slots so a single survivor cannot satisfy a multi-symbol workflow

#### Scenario: MA ticker survives plain comparison

- **WHEN** the user says "compare V and MA"
- **THEN** OpenCandle SHALL retain `MA` as the Mastercard ticker

#### Scenario: MA moving-average usage is not a ticker

- **WHEN** the user says "compare the 20 day MA and 50 day MA for SPY"
- **THEN** OpenCandle SHALL NOT treat `MA` as a ticker symbol
