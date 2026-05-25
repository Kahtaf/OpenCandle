## ADDED Requirements

### Requirement: Router Evals Cover Task-Family Selection

Router deterministic and live evals SHALL assert task-family selection in addition to route kind, workflow, entities, slots, tool bundles, and missing required fields.

#### Scenario: Sentiment prompt selects sentiment task family

- **WHEN** a router eval input asks whether retail mood around a ticker has shifted
- **THEN** the expected router output includes a sentiment-oriented task family and the sentiment tool bundle

#### Scenario: Concept prompt selects concept task family

- **WHEN** a router eval input asks for an educational explanation without named securities or current examples
- **THEN** the expected router output includes a concept-explainer task family and no active finance tool bundle

#### Scenario: Retail tradeoff prompt selects retail task family

- **WHEN** a router eval input asks about brokerage choice, safe cash products, mortgage-vs-investing, tax-loss harvesting, or crypto sizing
- **THEN** the expected output includes a retail tradeoff-oriented task family or planning diagnostic
- **AND** it does not require market-data tools unless current security-specific facts are requested

### Requirement: Router Evals Cover Commitment Mode

Router deterministic and live evals SHALL assert commitment mode where the prompt's requested answer shape is material to behavior.

#### Scenario: Decision prompt selects decision mode

- **WHEN** a router eval input asks whether to buy, wait, or avoid a security
- **THEN** the expected output includes a decision-oriented commitment mode

#### Scenario: Tradeoff prompt selects comparison mode

- **WHEN** a router eval input asks for pros and cons or tradeoffs without asking for a portfolio build
- **THEN** the expected output includes a comparison-oriented commitment mode

### Requirement: Router Evals Preserve Existing Routing Expectations

Adding task-family assertions SHALL NOT weaken existing route/workflow fixture expectations. Existing route kind, workflow, entity, slot, tool-bundle, prior-turn, and memory expectations SHALL remain part of router evals.

#### Scenario: Existing workflow dispatch remains asserted

- **WHEN** a portfolio-builder fixture is updated with task-family metadata
- **THEN** the fixture still asserts workflow dispatch, required slots, slot provenance, and tool bundles

#### Scenario: Existing clarification behavior remains asserted

- **WHEN** a missing-symbol options fixture is updated with task-family metadata
- **THEN** the fixture still asserts clarification route kind and missing required fields

### Requirement: Router Live Eval Reports Planning Accuracy

The live router eval SHALL report task-family accuracy separately from route/workflow accuracy. It SHALL report policy-card accuracy for migrated or dual-run behaviors where policy-card expectations are defined.

#### Scenario: Live eval reports task-family pass rate

- **WHEN** a developer runs the live router eval
- **THEN** the report includes aggregate route accuracy, workflow accuracy, task-family accuracy, and any defined policy-card accuracy

#### Scenario: Task-family failure does not hide route success

- **WHEN** the live router chooses the correct route kind but wrong task family
- **THEN** the report records route success and task-family failure separately

#### Scenario: Commitment-mode accuracy is reported

- **WHEN** live router eval cases include commitment-mode expectations
- **THEN** the report includes commitment-mode accuracy separately from route and task-family accuracy

### Requirement: Router Evals Cover Followup Context

Router evals SHALL include multi-turn cases where prior context determines task family, commitment mode, entity replacement, or clarification behavior.

#### Scenario: Followup entity replacement

- **WHEN** a prior turn asked about VOO versus QQQ and the followup asks "what about SCHD instead?"
- **THEN** the expected output preserves the comparison task shape and identifies the replaced entity

#### Scenario: Ambiguous followup asks clarification

- **WHEN** a followup uses "that" or "same thing" and prior context is insufficient
- **THEN** the expected route or planning diagnostics require clarification rather than silent guessing
