# turn-context-resolution Specification

## Purpose
TBD - created by archiving change typed-finance-router. Update Purpose after archive.
## Requirements
### Requirement: Resolved Turn Context

The system SHALL build a `ResolvedTurnContext` after router post-processing and before prompt assembly. The context SHALL be the application-facing record for the current turn and SHALL include route kind, legacy route mapping while needed, workflow, normalized entities, slots with source provenance, missing required slots, selected tool bundles, memory query plan, retrieved memory provenance, prompt playbook, and diagnostics.

#### Scenario: Context is built before prompt assembly

- **WHEN** the router output has been validated and normalized
- **THEN** a `ResolvedTurnContext` is built before the main-agent prompt is assembled

#### Scenario: Context includes tool scope

- **WHEN** route tool bundles are selected for the turn
- **THEN** the resolved context includes selected bundle names and active tool names

#### Scenario: Context includes correction diagnostics

- **WHEN** deterministic post-processing corrects the router output
- **THEN** the resolved context includes a diagnostic describing the correction

### Requirement: Typed Memory Query Planning

Memory retrieval SHALL be planned from the resolved route kind, workflow, entities, slots, and route capability manifest. Preferences, prior turns, workflow summaries, tool observations, and durable user memory SHALL remain separate memory categories with category-specific provenance.

#### Scenario: Workflow dispatch retrieves workflow summaries

- **WHEN** `routeKind` is `"workflow_dispatch"` and the selected workflow has prior summaries
- **THEN** the memory query plan includes recent relevant workflow summaries for that workflow

#### Scenario: Agent task retrieves entity-specific context

- **WHEN** `routeKind` is `"agent_task"` and the prompt contains a symbol
- **THEN** the memory query plan can retrieve prior turns or tool observations associated with that symbol

#### Scenario: Pass-through skips finance memory

- **WHEN** `routeKind` is `"pass_through"`
- **THEN** finance-specific memory categories are not added to the prompt

### Requirement: Memory Provenance and Staleness Filtering

Router-visible and analyst-visible memory SHALL use the same trust and staleness filtering rules. Any memory item used to fill a slot or influence prompt context SHALL carry category, source, timestamp, relevance, and trust/staleness metadata in the resolved turn context.

#### Scenario: Preference fills a slot with provenance

- **WHEN** a saved risk profile fills `risk_profile`
- **THEN** the slot source records the preference source and the resolved context records the memory item used

#### Scenario: Stale memory is not injected

- **WHEN** a memory item fails the configured staleness or trust filter
- **THEN** it is omitted from router-visible and analyst-visible prompt context
- **AND** the resolved context records that a candidate memory item was filtered

#### Scenario: Prior-turn pronoun resolution is auditable

- **WHEN** the current turn says "what about at $500?" and prior context resolves the symbol
- **THEN** the resolved context records the prior turn that supplied the symbol

