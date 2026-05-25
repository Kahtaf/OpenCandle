## ADDED Requirements

### Requirement: Typed Answer Artifact Contracts

The planning layer SHALL expose typed answer artifact contract identifiers for structured intermediate outputs while keeping V1 trace-only and avoiding persisted workspace or UI requirements.

#### Scenario: Artifact contracts are typed trace metadata

- **WHEN** planning metadata includes artifact contract identifiers
- **THEN** each identifier maps to a registry entry with an owning task family set, description, and lifecycle status
- **AND** V1 treats the contract as trace-only unless a later spec promotes rendering or persistence

#### Scenario: Concept education can request example table structure

- **WHEN** a concept education policy card would benefit from examples, cross-checks, or comparison rows
- **THEN** planning MAY include `concept_example_table`
- **AND** the answer still remains a prose educational answer unless a later spec implements rendered artifacts

#### Scenario: Portfolio rebalance can request exposure and action artifacts

- **WHEN** a portfolio rebalance review policy card is selected
- **THEN** planning MAY include `portfolio_exposure_map` and `rebalance_action_plan`
- **AND** those IDs do not imply exact holdings overlap, tax-lot optimization, or persisted portfolio storage

#### Scenario: Source-heavy tasks can request source coverage structure

- **WHEN** sentiment, filing, or current-event tasks require source/gap visibility
- **THEN** planning MAY include `source_coverage_table`
- **AND** the trace must still distinguish unavailable provider coverage from available evidence

#### Scenario: Artifact contracts do not create new task families by themselves

- **WHEN** a task can reuse an existing task family, evidence plan, and answer contract
- **THEN** adding an artifact contract does not require a new task family
