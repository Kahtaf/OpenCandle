## ADDED Requirements

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
