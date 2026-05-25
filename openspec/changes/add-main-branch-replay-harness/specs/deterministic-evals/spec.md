## ADDED Requirements

### Requirement: Main Branch Product Replay Harness

Deterministic eval tooling SHALL provide a branch-vs-ref product replay harness that compares current checkout behavior against a git ref such as `origin/main` without requiring current branch-only scripts to exist on the base ref.

#### Scenario: Product evals are compared across refs

- **WHEN** a developer runs the main-branch product replay harness
- **THEN** the harness runs product evals for the current checkout and the selected base ref when supported
- **AND** it writes a combined comparison report under `tests/evals/runs/`
- **AND** the report includes ref names, report paths, score deltas, pass/fail deltas, and per-case changes when available

#### Scenario: Unsupported base ref is reported honestly

- **WHEN** the selected base ref does not support the requested eval command or report schema
- **THEN** the harness records the unsupported reason in the comparison report
- **AND** it does not count the unsupported run as a product win or loss

#### Scenario: Replay harness avoids branch patching

- **WHEN** the harness prepares a base-ref worktree
- **THEN** it does not edit the base ref to install current branch scripts
- **AND** comparison logic runs from the current checkout after reports are collected
