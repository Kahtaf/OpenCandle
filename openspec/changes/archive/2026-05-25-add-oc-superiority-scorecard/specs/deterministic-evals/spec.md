## ADDED Requirements

### Requirement: OpenCandle Superiority Scorecard

Deterministic eval tooling SHALL provide a composed scorecard that explains whether the current branch is below, at, or better than main parity using existing replay and prompt-policy reports.

#### Scenario: Scorecard composes report evidence

- **WHEN** product replay, competitive replay, and prompt-policy manifest reports are supplied
- **THEN** the scorecard classifies each layer independently
- **AND** it writes an auditable JSON report under `tests/evals/runs/`

#### Scenario: Blocking regressions are explicit

- **WHEN** any supplied report shows a current-vs-base regression
- **THEN** the scorecard status is `below_main_parity`
- **AND** the blocking layer and reason are included in the report

#### Scenario: Architecture signals are part of superiority

- **WHEN** current behavior matches or beats main
- **THEN** the scorecard also records planning metadata, artifact-contract, and structured-check availability
- **AND** those signals are used to distinguish maintainable parity from prompt-bloat parity
