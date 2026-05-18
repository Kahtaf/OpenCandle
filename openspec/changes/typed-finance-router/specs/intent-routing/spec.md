## MODIFIED Requirements

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

## ADDED Requirements

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
