## ADDED Requirements

### Requirement: Main Branch Competitive Replay Harness

LLM-judge eval tooling SHALL provide a current-vs-ref competitive replay report for fixed finance prompts without requiring current branch-only code to exist on the base ref.

#### Scenario: Competitive reports are compared across refs

- **WHEN** a developer supplies current and base competitive finance reports for matching fixed prompts
- **THEN** the harness writes a combined comparison report under `tests/evals/runs/`
- **AND** the report includes ref names, report paths, OpenCandle score deltas, winner changes, and cached competitor coverage

#### Scenario: Planning metadata is preserved for parity diagnosis

- **WHEN** competitive report cases include OpenCandle planning metadata
- **THEN** the comparison report preserves current and base planning metadata per prompt
- **AND** regressions can be traced to planning, evidence, answer-contract, structured-check, retry, synthesis, or harness layers

#### Scenario: Unsupported competitive replay is honest

- **WHEN** the selected base ref cannot produce or parse a compatible competitive report
- **THEN** the harness records an unsupported reason
- **AND** it does not count the unsupported run as an OpenCandle win or loss
