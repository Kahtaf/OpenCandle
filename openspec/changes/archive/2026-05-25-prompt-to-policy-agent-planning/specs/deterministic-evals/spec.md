## ADDED Requirements

### Requirement: Planning Fields Captured in Deterministic Traces

Deterministic eval traces SHALL include planning-layer fields: planning version, task family, commitment mode, policy card identifier, evidence plan identifier, answer contract identifier, structured-check identifiers, optional workspace/artifact placeholder identifiers, capability-gap identifiers, evidence records, structured-check failures, and retry eligibility when present.

#### Scenario: Trace includes planning metadata

- **WHEN** an always-tier eval case runs through the harness
- **THEN** the trace includes route/workflow metadata and planning metadata for the turn

#### Scenario: Trace includes structured-check result

- **WHEN** structured checks run for an eval case
- **THEN** the trace records which checks passed or failed
- **AND** active corrective retry is not required in V1

### Requirement: Before/After Migration Characterization

Before removing global prompt clauses or weakening deterministic behavior, the deterministic eval suite SHALL contain characterization coverage for the behavior protected by those clauses or logic. After migration, the same cases SHALL be rerunnable to compare route, workflow, tool, evidence, provider-gap, structured-check, and final-answer behavior.

#### Scenario: Prompt-protected behavior characterized before deletion

- **WHEN** a scenario-specific global prompt clause is selected for removal
- **THEN** at least one deterministic or scripted harness case covers the behavior before the clause is deleted

#### Scenario: Deterministic routing behavior characterized before change

- **WHEN** a deterministic router correction, workflow dispatch rule, tool-scope rule, or provider-degradation behavior is selected for change
- **THEN** deterministic tests cover the current behavior before the change is activated

#### Scenario: After migration preserves behavior

- **WHEN** the migrated policy/evidence/contract/structured-check path replaces a global prompt clause
- **THEN** the corresponding characterization case passes against the new path

#### Scenario: V1 scaffold can pass before full migration

- **WHEN** a task family has only observational planning metadata in V1
- **THEN** deterministic evals can assert the metadata and trace shape
- **AND** they do not require deletion of all legacy prompt guidance

#### Scenario: Shadow planning does not change active behavior

- **WHEN** shadow planning is enabled for a parity-ledger entry
- **THEN** deterministic evals compare shadow planning output to legacy behavior
- **AND** the legacy route, workflow, tool behavior, and final answer obligations remain active until the parity gate passes

### Requirement: Parity Ledger Report

Deterministic eval reports SHALL include parity-ledger status for migrated behavior and SHALL fail unaccepted regressions against the current baseline.

#### Scenario: Parity report blocks unreviewed regression

- **WHEN** a migrated path changes route kind, workflow, active tool calls, provider-gap disclosure, required evidence, or final-answer obligations
- **THEN** the deterministic report marks the ledger entry as failed unless the change is recorded as an accepted improvement

#### Scenario: Judge improvement cannot override hard assertion failure

- **WHEN** a migrated path receives a better judge score but fails a required hard assertion from the parity ledger
- **THEN** the deterministic report marks the ledger entry as failed
- **AND** the failure can be accepted only if the ledger records an explicit accepted improvement with changed expected assertions

#### Scenario: Dual-run comparison is available

- **WHEN** a behavior is in `dual_run` status
- **THEN** the report compares legacy and replacement route, tool, evidence, structured checks, optional artifact placeholders, and final-answer obligations before the replacement becomes active

### Requirement: Layered Failure Classification

Deterministic eval reports SHALL classify failures by layer: routing, planning, evidence plan, tool capability, evidence normalization, answer contract, structured check, retry eligibility, or synthesis.

#### Scenario: Missing tool call classified as evidence-plan failure

- **WHEN** the route and task family are correct but required evidence is not requested
- **THEN** the eval report classifies the failure as an evidence-plan failure rather than a generic final-answer failure

#### Scenario: Structured evidence mismatch classified as structured-check failure

- **WHEN** an answer contract requires structured evidence such as freshness, source coverage, or provider-gap disclosure and that evidence is absent
- **THEN** the eval report classifies the failure as a structured-check or evidence-normalization failure

#### Scenario: Missing data source classified as capability gap

- **WHEN** a prompt requires exact ETF holdings overlap, brokerage fee/yield comparison, live cash-product rates, or market-calendar data that OpenCandle cannot fetch
- **THEN** the eval report records a capability-gap identifier instead of recommending a new global prompt clause

#### Scenario: Disclosed gap is honest but not specialist-competitive

- **WHEN** OpenCandle correctly discloses a capability gap for a prompt requiring specialist finance data or computation
- **THEN** the eval report may mark current-behavior honesty as preserved
- **AND** it reports that capability as not specialist-competitive until the gap is closed

### Requirement: Workspace Artifact Placeholders Are Deferred

Deterministic evals SHALL NOT require full workspace artifact generation in V1. They MAY assert placeholder IDs, minimal evidence records, raw trace pointers, or capability gaps for prompt families that would later benefit from intermediate structured work.

#### Scenario: Sentiment prompt expects source coverage metadata

- **WHEN** a sentiment-divergence eval runs
- **THEN** the eval can assert source-coverage metadata or a future artifact placeholder
- **AND** it does not require a full source-coverage artifact in V1

#### Scenario: Filing prompt expects filing evidence separation

- **WHEN** a filing-thesis eval runs
- **THEN** the eval can assert filing metadata, filing evidence, and filing-vs-news separation
- **AND** it does not require a full filing-change artifact in V1

### Requirement: Prompt Size Regression Gate

The deterministic test suite SHALL include prompt assembly assertions that detect truncation and prompt-size regressions in production prompt variants.

#### Scenario: Production prompt contains no active-section truncation

- **WHEN** the standard, workflow, fallback, clarification, pass-through, and no-tool prompt variants are assembled
- **THEN** active non-memory sections contain no truncation marker

#### Scenario: Prompt growth is visible

- **WHEN** a prompt section exceeds its configured budget
- **THEN** the deterministic test output identifies the section and prompt variant that exceeded the budget

### Requirement: Migration Prompt Manifest Is Stable

Before/after migration comparisons SHALL use a committed prompt manifest with exact prompt text and expected assertions rather than generated prompts.

#### Scenario: Manifest pins prompt identity and assertions

- **WHEN** a migration prompt is added to the before/after set
- **THEN** the manifest records prompt ID, exact prompt text, followup sequence when applicable, expected hard assertions, optional judge assertions, baseline OpenCandle report path, competitor baseline path or hash, model/date metadata, and cached-competitor-answer policy

#### Scenario: Prompt drift is visible

- **WHEN** prompt text or expected assertions change
- **THEN** the manifest diff shows the changed prompt identity or accepted assertion change
- **AND** the baseline comparison cannot silently reuse stale expectations

### Requirement: Followup Characterization

Deterministic evals SHALL include multi-turn cases for planning carryover, entity replacement, changed constraints, stale evidence invalidation, and ambiguous prior context.

#### Scenario: Followup preserves task family

- **WHEN** a user follows an ETF comparison with "what about SCHD instead?"
- **THEN** the eval can assert the same task family and commitment mode with the replaced entity

#### Scenario: Followup refreshes time-sensitive evidence

- **WHEN** a followup asks for the same "today" analysis later in a session
- **THEN** the eval can assert whether market-status and quote evidence were refreshed or explicitly reused
