## ADDED Requirements

### Requirement: Deterministic Reports Include Artifact Contract IDs

Deterministic eval traces and reports SHALL expose typed artifact contract identifiers when planning selects them.

#### Scenario: Trace includes artifact contracts

- **WHEN** planning selects trace-only artifact contracts
- **THEN** the deterministic trace includes those contract IDs alongside existing planning metadata
- **AND** no rendered artifact file is required

#### Scenario: Artifact contracts can be asserted without rendering

- **WHEN** an eval case targets a prompt with expected structured intermediate work
- **THEN** it MAY assert artifact contract IDs
- **AND** the assertion does not require persisted workspace storage or UI artifacts
