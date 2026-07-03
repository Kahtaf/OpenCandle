## RENAMED Requirements

- FROM: `### Requirement: Single LLM Router Call per Turn (Behind Rollout Flag)`
- TO: `### Requirement: Single LLM Router Call per Turn`

## MODIFIED Requirements

### Requirement: Single LLM Router Call per Turn

The system SHALL invoke a single LLM-based router call on every user turn before system-prompt assembly. The router SHALL emit a structured JSON output containing route classification, entities, slots with provenance, preference updates, and a `missing_required` list. The LLM router is the only production routing path; no rules-mode primary dispatch exists.

#### Scenario: Router runs on every turn

- **WHEN** the user submits a turn through `pi.on("input")`
- **THEN** exactly one router LLM call is made before the main-agent prompt is assembled

#### Scenario: Unset router mode uses the LLM router

- **WHEN** `OPENCANDLE_ROUTER_MODE` is unset
- **THEN** OpenCandle routes input through the LLM router

#### Scenario: Rules mode is rejected with migration guidance

- **WHEN** `OPENCANDLE_ROUTER_MODE=rules` is set
- **THEN** config loading fails fast with an error explaining that the rules router was removed and the variable should be unset

#### Scenario: Router output is structured and validated

- **WHEN** the router returns a response
- **THEN** the response is parsed and validated against the defined JSON schema; on validation failure, one retry is attempted with error feedback; on persistent failure, the router emits a minimal fallback output (`route: "fallback"`, extracted symbols only, empty slots, empty preference_updates, empty missing_required)

### Requirement: Deterministic Router as Post-Processor

Deterministic routing code SHALL NOT make the primary route decision. Deterministic code SHALL validate and normalize the LLM output, enforce manifest constraints, compute missing required slots, and produce diagnostics for any correction. Deterministic safety nets — acronym disambiguation, symbol preflight and provider invalid-symbol handling, compare-abort clarification, and tool validation — SHALL remain active on LLM router output.

#### Scenario: LLM route remains primary

- **WHEN** the router emits valid `routeKind: "agent_task"`
- **THEN** deterministic code does not override it with a legacy keyword route

#### Scenario: Invalid route kind is corrected

- **WHEN** the LLM router emits an invalid route kind
- **THEN** post-processing applies the documented fallback correction and records a diagnostic explaining the correction

#### Scenario: Deterministic safety nets survive rules-router removal

- **WHEN** the legacy rules router is removed as a dispatch path
- **THEN** acronym disambiguation, workflow symbol preflight, provider/tool validation, and compare clarification aborts continue to run against LLM router output

## ADDED Requirements

### Requirement: Rules Router Removal Requires Acceptance Evidence

The legacy rules-router dispatch path SHALL only be removed after the live router eval has been run against the production model with the results recorded in the change, including a classification of every fixture failure. Failures SHALL be either benign model-choice differences (extra informational slots, richer workflow labels with the same route kind, internal diagnostics differences) or individually explained; unexplained route-kind regressions block the removal. The eval diff SHALL compare the routing contract (route kind, workflow, entities, slots, missing required, tool bundles, preference updates) and not internal correction diagnostics, which are model-recording-specific.

#### Scenario: Acceptance evidence precedes removal

- **WHEN** the change removing rules-mode dispatch is prepared
- **THEN** `eval:router-live` has been run with live credentials against the production model
- **AND** the run output and a per-failure classification are recorded in the implementing PR before the removal lands

#### Scenario: Route-kind regressions block removal

- **WHEN** the live eval shows a fixture whose route kind disagrees with the recorded expectation and no documented explanation accounts for it
- **THEN** the rules-router removal does not land until the regression is fixed or the fixture is re-recorded with justification
